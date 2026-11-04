// GET /api/license?id=<installId>[&session=<checkout session id>][&confirm=1]
// Answers whether that install paid to remove ads: {adFree, plan, until}.
// The thanks page adds confirm=1 when it first confirms its checkout: if
// that was the install's first purchase, it's reported to PostHog as `paid`
// after the answer goes out (api/_posthog.js).
import { waitUntil } from "@vercel/functions";
import { capture, paidEvent } from "./_posthog.js";
import { checkLicense, firstSale, isInstallId, isSessionId, json, stripeClient } from "./_stripe.js";

/** Never holds up or fails the license answer. */
export async function reportSale(stripe, installId, sessionId, send = capture) {
  try {
    const sale = await firstSale(stripe, installId, sessionId);
    if (sale) await send(paidEvent(installId, sale));
  } catch (err) {
    console.error("paid event failed", err);
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const session = url.searchParams.get("session");
  if (!isInstallId(id) || (session && !isSessionId(session))) return json({ error: "Bad request" }, 400);
  const { STRIPE_SECRET_KEY } = process.env;
  if (!STRIPE_SECRET_KEY) return json({ error: "Payments aren't set up yet" }, 503);
  try {
    const stripe = stripeClient(STRIPE_SECRET_KEY);
    const answer = await checkLicense(stripe, id, session || undefined);
    if (answer.adFree && session && url.searchParams.get("confirm") === "1") waitUntil(reportSale(stripe, id, session));
    return json(answer);
  } catch (err) {
    console.error("license check failed", err);
    return json({ error: "Couldn't check right now" }, 502);
  }
}
