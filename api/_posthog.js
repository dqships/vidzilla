// Product analytics, server side: the `paid` event for an install's first
// purchase, sent to PostHog's capture API with fetch (no SDK, no secret: the
// project key can only send events). The extension sends the only other
// event, `activated` (src/sw/analytics.ts). Both use the install ID as the
// person, so a purchase joins the copy that made it.
import { createHash } from "node:crypto";

export const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
/** Vidzilla's PostHog project (708991). Publishable, like the one in the extension. */
export const POSTHOG_KEY = process.env.POSTHOG_KEY || "phc_r4QYEpdtzPfXKeND8mhAEM7stJtxtq8DmUuo9k38iQVx";

/** The same input always gives the same UUID, so PostHog can drop a repeat of one event. */
export function stableUuid(input) {
  const h = createHash("sha256").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * `paid` for a sale firstSale() found (api/_stripe.js). Amount in major units
 * (9 for $9.00), currency lowercase as Stripe gives it. The buyer's email
 * from Stripe goes on the person, as their only contact detail.
 */
export function paidEvent(installId, sale) {
  return {
    api_key: POSTHOG_KEY,
    event: "paid",
    distinct_id: installId,
    uuid: stableUuid(`paid:${sale.id}`),
    timestamp: new Date(sale.at).toISOString(),
    properties: {
      product: "vidzilla",
      plan: sale.plan,
      amount: sale.amount,
      currency: sale.currency,
      ...(sale.variant ? { variant: sale.variant } : {}),
      // Sent from Vercel: its address says nothing about where the buyer is.
      $geoip_disable: true,
      ...(sale.email ? { $set: { email: sale.email } } : {}),
    },
  };
}

/** Sends one event. Throws when PostHog doesn't take it. */
export async function capture(body, fetchImpl = fetch) {
  const res = await fetchImpl(`${POSTHOG_HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PostHog ${res.status}`);
}
