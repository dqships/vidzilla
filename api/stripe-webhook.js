// POST /api/stripe-webhook   (Stripe calls it; see docs/ad-free-upgrade.md#analytics)
// Reports Vidzilla's sales and cancellations to PostHog straight from Stripe,
// so they're counted even when the buyer never reaches the thanks page:
//   checkout.session.completed,             `paid` for an install's first
//   checkout.session.async_payment_succeeded  charge (subscription or lifetime)
//   invoice.paid                            `paid` for a renewal that is the
//                                           first charge (after a launch code
//                                           made the first periods free)
//   customer.subscription.deleted           `subscription_cancelled`
// The Stripe account is shared with other products: anything without
// Vidzilla's install ID is acknowledged and ignored, and so are test-mode
// events. Every event is the same PostHog event however often it's sent (a
// stable `uuid` and timestamp), so the thanks page and Stripe's retries
// never count twice. Nothing is stored here.
// Needs STRIPE_WEBHOOK_SECRET (the endpoint's signing secret, whsec_...).
import { createHmac, timingSafeEqual } from "node:crypto";
import { capture, paidEvent, subscriptionCancelledEvent } from "./_posthog.js";
import { endedSubscription, invoiceSale, isVidzillaSession, json, saleOf, stripeClient } from "./_stripe.js";

/** Stripe's default: a signature older than five minutes is a replay. */
export const WEBHOOK_TOLERANCE_S = 300;

/**
 * Checks a `Stripe-Signature` header (`t=...,v1=...`) against the raw body,
 * as Stripe documents for verifying webhooks without its SDK.
 */
export function verifySignature(payload, header, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !signatures.length || Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const SALE_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/**
 * Turns one verified Stripe event into PostHog events. Returns what it did,
 * for the log and the tests. Throws when Stripe or PostHog fails, so Stripe
 * sends it again.
 */
export async function handleEvent(event, { stripe, send = capture }) {
  if (event?.livemode === false) return "ignored: test mode";
  const object = event?.data?.object;
  if (SALE_EVENTS.has(event?.type)) {
    if (!isVidzillaSession(object)) return "ignored: not Vidzilla";
    const sale = await saleOf(stripe, object);
    if (!sale) return "ignored: unpaid or not a first purchase";
    await send(paidEvent(object.client_reference_id, sale));
    return "paid";
  }
  if (event?.type === "invoice.paid") {
    const sale = await invoiceSale(stripe, object);
    if (!sale) return "ignored: not a first charge on a Vidzilla renewal";
    await send(paidEvent(sale.installId, sale));
    return "paid";
  }
  if (event?.type === "customer.subscription.deleted") {
    const end = endedSubscription(object);
    if (!end) return "ignored: not an ended Vidzilla subscription";
    await send(subscriptionCancelledEvent(end));
    return "subscription_cancelled";
  }
  return "ignored: event type";
}

export async function POST(request) {
  const { STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY } = process.env;
  if (!STRIPE_WEBHOOK_SECRET || !STRIPE_SECRET_KEY) return json({ error: "The webhook isn't set up yet" }, 503);
  const payload = await request.text();
  if (!verifySignature(payload, request.headers.get("stripe-signature"), STRIPE_WEBHOOK_SECRET)) return json({ error: "Bad signature" }, 400);
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  try {
    const result = await handleEvent(event, { stripe: stripeClient(STRIPE_SECRET_KEY) });
    return json({ received: true, result });
  } catch (err) {
    console.error(`stripe webhook ${event?.type} ${event?.id} failed`, err);
    // Stripe retries for up to three days; the event's stable uuid keeps a retry from counting twice.
    return json({ error: "Couldn't report it. Stripe will retry." }, 500);
  }
}
