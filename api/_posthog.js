// Product analytics, server side: `checkout_started` when an install opens a
// Stripe checkout and `paid` for its first purchase, sent to PostHog's
// capture API with fetch (no SDK, no secret: the project key can only send
// events). The extension sends `signed_up` and `activated`
// (src/sw/analytics.ts). All four use the install ID as the person, so a
// purchase joins the copy that made it. The website's anonymous page views
// and store clicks use capture() too (api/_web-analytics.js).
import { createHash } from "node:crypto";
import { majorUnits } from "./_stripe.js";

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

/**
 * `checkout_started` for a Checkout Session api/checkout.js made: the plan,
 * the install's price group, the launch code applied (if any), and what the
 * checkout will charge in major units, discounts included, when Stripe says.
 */
export function checkoutStartedEvent(installId, { session, plan, variant, promoCode }) {
  const currency = typeof session.currency === "string" ? session.currency.toLowerCase() : undefined;
  const amount = typeof session.amount_total === "number" && currency ? majorUnits(session.amount_total, currency) : undefined;
  return {
    api_key: POSTHOG_KEY,
    event: "checkout_started",
    distinct_id: installId,
    ...(session.id ? { uuid: stableUuid(`checkout_started:${session.id}`) } : {}),
    ...(typeof session.created === "number" ? { timestamp: new Date(session.created * 1000).toISOString() } : {}),
    properties: {
      product: "vidzilla",
      plan,
      ...(variant ? { variant } : {}),
      ...(promoCode ? { promo_code: promoCode } : {}),
      ...(amount !== undefined ? { amount, currency } : {}),
      // Sent from Vercel: its address says nothing about where the buyer is.
      $geoip_disable: true,
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
