import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS Vercel function module
import { paidEvent } from "../../api/_posthog.js";
// @ts-expect-error plain JS Vercel function module
import { endedSubscription, firstSale, isVidzillaSession } from "../../api/_stripe.js";
// @ts-expect-error plain JS Vercel function module
import { handleEvent, POST, verifySignature, WEBHOOK_TOLERANCE_S } from "../../api/stripe-webhook.js";

const ID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";
const CREATED = 1_800_000_000;
const SESSION = "cs_live_abcdefghijkl";
const SECRET = "whsec_test_secret";
const empty = { data: [] };

const sign = (payload: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

type Body = { event: string; distinct_id: string; uuid: string; timestamp: string; properties: Record<string, unknown> };

/** A fake Stripe for the first-purchase searches. */
function stripeWith(payments: { data: unknown[] } = empty, subs: { data: unknown[] } = empty, session?: Record<string, unknown>) {
  return async (_method: string, path: string) => {
    if (path === "/v1/payment_intents/search") return payments;
    if (path === "/v1/subscriptions/search") return subs;
    if (session && path === `/v1/checkout/sessions/${SESSION}`) return session;
    throw new Error(`unexpected ${path}`);
  };
}

const lifetimeSession = {
  id: SESSION,
  object: "checkout.session",
  client_reference_id: ID,
  status: "complete",
  payment_status: "paid",
  mode: "payment",
  amount_total: 900,
  currency: "usd",
  created: CREATED,
  payment_intent: "pi_1",
  customer_details: { email: "a@b.co" },
  metadata: { install_id: ID, plan: "lifetime", variant: "c" },
};

const subscriptionSession = { ...lifetimeSession, mode: "subscription", amount_total: 700, payment_intent: null, subscription: "sub_1", metadata: { install_id: ID, plan: "subscription", variant: "c" } };

const event = (type: string, object: unknown, over: Record<string, unknown> = {}) => ({ id: "evt_1", type, livemode: true, data: { object }, ...over });

const endedSub = {
  id: "sub_1",
  object: "subscription",
  status: "canceled",
  start_date: CREATED,
  created: CREATED,
  ended_at: CREATED + 30 * 86_400,
  canceled_at: CREATED + 20 * 86_400,
  trial_end: null,
  cancellation_details: { reason: "cancellation_requested", feedback: "too_expensive", comment: "free text stays out" },
  metadata: { install_id: ID, variant: "b" },
};

describe("signature", () => {
  const payload = JSON.stringify({ id: "evt_1" });

  it("accepts Stripe's signature and rejects anything else", () => {
    expect(verifySignature(payload, sign(payload, CREATED), SECRET, CREATED)).toBe(true);
    expect(verifySignature(`${payload} `, sign(payload, CREATED), SECRET, CREATED)).toBe(false);
    expect(verifySignature(payload, sign(payload, CREATED, "whsec_other"), SECRET, CREATED)).toBe(false);
    expect(verifySignature(payload, null, SECRET, CREATED)).toBe(false);
    expect(verifySignature(payload, `t=${CREATED},v1=short`, SECRET, CREATED)).toBe(false);
  });

  it("rejects a replay older than the tolerance", () => {
    expect(verifySignature(payload, sign(payload, CREATED), SECRET, CREATED + WEBHOOK_TOLERANCE_S + 1)).toBe(false);
  });

  it("accepts any of several v1 signatures (a secret being rolled)", () => {
    const header = `t=${CREATED},v1=${"0".repeat(64)},${sign(payload, CREATED).split(",")[1]}`;
    expect(verifySignature(payload, header, SECRET, CREATED)).toBe(true);
  });
});

describe("paid from the webhook", () => {
  it("reports a lifetime purchase as the same event the thanks page sends", async () => {
    const sent: Body[] = [];
    const stripe = stripeWith({ data: [{ id: "pi_1", created: CREATED }] });
    const result = await handleEvent(event("checkout.session.completed", lifetimeSession), { stripe, send: async (b: Body) => void sent.push(b) });
    expect(result).toBe("paid");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ event: "paid", distinct_id: ID, timestamp: new Date(CREATED * 1000).toISOString() });
    expect(sent[0]!.properties).toEqual({ product: "vidzilla", plan: "lifetime", amount: 9, currency: "usd", variant: "c", $geoip_disable: true, $set: { email: "a@b.co" } });

    // The thanks page's report of the same checkout: same uuid, same timestamp, so PostHog keeps one.
    const fromThanksPage = paidEvent(ID, await firstSale(stripeWith({ data: [{ id: "pi_1", created: CREATED }] }, empty, lifetimeSession), ID, SESSION, CREATED * 1000 + 60_000));
    expect(fromThanksPage).toEqual(sent[0]);
  });

  it("reports a subscription's first payment", async () => {
    const sent: Body[] = [];
    const stripe = stripeWith(empty, { data: [{ id: "sub_1", created: CREATED }] });
    expect(await handleEvent(event("checkout.session.completed", subscriptionSession), { stripe, send: async (b: Body) => void sent.push(b) })).toBe("paid");
    expect(sent[0]!.properties).toMatchObject({ plan: "subscription", amount: 7, currency: "usd", variant: "c" });
  });

  it("waits for a delayed payment to succeed", async () => {
    const send = vi.fn();
    const pending = { ...lifetimeSession, payment_status: "unpaid" };
    expect(await handleEvent(event("checkout.session.completed", pending), { stripe: stripeWith(), send })).toMatch(/^ignored/);
    expect(await handleEvent(event("checkout.session.async_payment_succeeded", lifetimeSession), { stripe: stripeWith(), send })).toBe("paid");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("isn't reported for a later purchase by the same install", async () => {
    const send = vi.fn();
    const resubscribed = { ...subscriptionSession, subscription: "sub_2" };
    const stripe = stripeWith(empty, { data: [{ id: "sub_1", created: CREATED - 86_400 * 400 }, { id: "sub_2", created: CREATED }] });
    expect(await handleEvent(event("checkout.session.completed", resubscribed), { stripe, send })).toMatch(/^ignored/);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores the other products on the Stripe account, and test mode", async () => {
    const send = vi.fn();
    const stripe = async () => {
      throw new Error("Stripe isn't asked about other products");
    };
    const guppy = { ...lifetimeSession, client_reference_id: "user_3LfIqa5Lgg1OMBnlb2V0ImgRkpq", metadata: { app: "guppy", plan: "monthly" } };
    const beans = { ...lifetimeSession, client_reference_id: null, metadata: { app: "beans", plan: "monthly", user_id: "x|user_1" } };
    const taggedOther = { ...lifetimeSession, metadata: { ...lifetimeSession.metadata, app: "beans" } };
    for (const s of [guppy, beans, taggedOther]) expect(await handleEvent(event("checkout.session.completed", s), { stripe, send })).toMatch(/^ignored/);
    expect(await handleEvent(event("customer.subscription.deleted", { ...endedSub, metadata: { app: "guppy", clerk_user_id: "user_1" } }), { stripe, send })).toMatch(/^ignored/);
    expect(await handleEvent(event("checkout.session.completed", lifetimeSession, { livemode: false }), { stripe, send })).toMatch(/^ignored/);
    expect(await handleEvent(event("invoice.paid", {}), { stripe, send })).toMatch(/^ignored/);
    expect(send).not.toHaveBeenCalled();
    expect(isVidzillaSession(lifetimeSession)).toBe(true);
  });
});

describe("subscription_cancelled", () => {
  it("sends Beans' and Guppy's properties, under the install ID", async () => {
    const sent: Body[] = [];
    expect(await handleEvent(event("customer.subscription.deleted", endedSub), { stripe: stripeWith(), send: async (b: Body) => void sent.push(b) })).toBe("subscription_cancelled");
    expect(sent[0]).toMatchObject({ event: "subscription_cancelled", distinct_id: ID, timestamp: new Date((CREATED + 30 * 86_400) * 1000).toISOString() });
    expect(sent[0]!.properties).toEqual({
      product: "vidzilla",
      plan: "subscription",
      variant: "b",
      cancellation_reason: "too_expensive",
      stripe_cancellation_reason: "cancellation_requested",
      days_subscribed: 30,
      ended_in_trial: false,
      $geoip_disable: true,
    });
  });

  it("is one event per subscription however often Stripe sends it", async () => {
    const sent: Body[] = [];
    const send = async (b: Body) => void sent.push(b);
    await handleEvent(event("customer.subscription.deleted", endedSub), { stripe: stripeWith(), send });
    await handleEvent(event("customer.subscription.deleted", endedSub, { id: "evt_2" }), { stripe: stripeWith(), send });
    expect(sent[0]).toEqual(sent[1]);
    const other = await (async () => {
      const out: Body[] = [];
      await handleEvent(event("customer.subscription.deleted", { ...endedSub, id: "sub_2" }), { stripe: stripeWith(), send: async (b: Body) => void out.push(b) });
      return out[0];
    })();
    expect(other!.uuid).not.toBe(sent[0]!.uuid);
  });

  it("falls back to Stripe's reason, and spots a trial that never paid", () => {
    const trial = { ...endedSub, trial_end: CREATED + 7 * 86_400, ended_at: CREATED + 3 * 86_400, cancellation_details: { reason: "payment_failed", feedback: null } };
    expect(endedSubscription(trial)).toMatchObject({ reason: "payment_failed", feedback: null, daysSubscribed: 3, endedInTrial: true });
  });

  it("isn't sent for a subscription that never started or is still running", async () => {
    const send = vi.fn();
    for (const status of ["incomplete_expired", "active"]) expect(await handleEvent(event("customer.subscription.deleted", { ...endedSub, status }), { stripe: stripeWith(), send })).toMatch(/^ignored/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("POST /api/stripe-webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const request = (payload: string, signature: string | null) =>
    new Request("https://vidzilla.followusai.com/api/stripe-webhook", { method: "POST", body: payload, headers: signature ? { "Stripe-Signature": signature } : {} });

  it("says it isn't set up without the signing secret", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test");
    expect((await POST(request("{}", null))).status).toBe(503);
  });

  it("rejects an unsigned or badly signed request", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test");
    expect((await POST(request("{}", null))).status).toBe(400);
    const now = Math.floor(Date.now() / 1000);
    expect((await POST(request("{}", sign("{}", now, "whsec_other")))).status).toBe(400);
  });

  it("acknowledges a signed event it has nothing to do with", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test");
    const payload = JSON.stringify(event("invoice.paid", {}));
    const res = await POST(request(payload, sign(payload, Math.floor(Date.now() / 1000))));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: "ignored: event type" });
  });
});
