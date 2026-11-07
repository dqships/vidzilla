import { describe, expect, it, vi } from "vitest";
import { activateOnce, activatedEvent, noteActivated, noteInstalled, olderVersion, POSTHOG_KEY, retrySignUp, signedUpEvent, signUpOnce, skipActivationIfSavedBefore, type ActivationDeps, type SignUpDeps } from "../../src/sw/analytics";
// @ts-expect-error plain JS Vercel function module
import { capture, paidEvent, stableUuid } from "../../api/_posthog.js";
// @ts-expect-error plain JS Vercel function module
import { firstSale, majorUnits, SALE_WINDOW_MS } from "../../api/_stripe.js";
// @ts-expect-error plain JS Vercel function module
import { reportSale } from "../../api/license.js";

const ID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";

/** Synced storage and PostHog, faked. */
function deps(over: Partial<ActivationDeps> = {}) {
  let activatedAt: number | undefined;
  const sent: unknown[] = [];
  const d: ActivationDeps = {
    activatedAt: async () => activatedAt,
    markActivated: async (at) => void (activatedAt = at),
    installId: async () => ID,
    send: async (body) => (sent.push(body), true),
    version: "1.0.5",
    now: () => 1_800_000_000_000,
    ...over,
  };
  return { d, sent, get activatedAt() { return activatedAt; } };
}

describe("activated", () => {
  it("goes out on the first save only, with the install ID as the person", async () => {
    const f = deps();
    expect(await activateOnce(f.d)).toBe(true);
    expect(await activateOnce(f.d)).toBe(false);
    expect(f.sent).toEqual([activatedEvent(ID, "1.0.5", 1_800_000_000_000)]);
    expect(f.activatedAt).toBe(1_800_000_000_000);
  });

  it("tries again on the next save when sending failed", async () => {
    let ok = false;
    const f = deps({ send: async () => ok });
    expect(await activateOnce(f.d)).toBe(false);
    expect(f.activatedAt).toBeUndefined();
    ok = true;
    expect(await activateOnce(f.d)).toBe(true);
  });

  it("sends once when two saves finish together", async () => {
    const f = deps();
    await Promise.all([noteActivated(f.d), noteActivated(f.d), noteActivated(f.d)]);
    expect(f.sent).toHaveLength(1);
  });

  it("carries the product and version, nothing about the page or file, and no location", () => {
    const e = activatedEvent(ID, "1.0.5", 0);
    expect(e).toMatchObject({ api_key: POSTHOG_KEY, event: "activated", distinct_id: ID, timestamp: "1970-01-01T00:00:00.000Z" });
    expect(e.properties).toEqual({ product: "vidzilla", extension_version: "1.0.5", $geoip_disable: true, $set_once: { activated_at: "1970-01-01T00:00:00.000Z" } });
  });

  it("isn't sent for a copy that saved files before analytics existed", async () => {
    const before = deps();
    expect(await skipActivationIfSavedBefore("1.0.4", 3, before.d)).toBe(true);
    expect(await activateOnce(before.d)).toBe(false);
    expect(before.sent).toEqual([]);
    // Nothing saved yet, or updated from a version that already reports: its first save counts.
    expect(await skipActivationIfSavedBefore("1.0.4", 0, deps().d)).toBe(false);
    expect(await skipActivationIfSavedBefore("1.0.5", 3, deps().d)).toBe(false);
  });

  it("compares versions numerically", () => {
    expect(olderVersion("1.0.4", "1.0.5")).toBe(true);
    expect(olderVersion("1.0.10", "1.0.5")).toBe(false);
    expect(olderVersion("1.0.5", "1.0.5")).toBe(false);
    expect(olderVersion("0.9", "1.0.5")).toBe(true);
  });
});

type List = { data: { id: string; created: number }[] };
const empty: List = { data: [] };
const CREATED = 1_800_000_000; // seconds, as Stripe gives them
const NOW = CREATED * 1000 + 60_000;
const SESSION = "cs_live_abcdefghijkl";

function stripeWith(session: Record<string, unknown>, payments: List = empty, subs: List = empty) {
  const routes: Record<string, unknown> = {
    [`/v1/checkout/sessions/${SESSION}`]: { id: SESSION, client_reference_id: ID, status: "complete", payment_status: "paid", created: CREATED, ...session },
    "/v1/payment_intents/search": payments,
    "/v1/subscriptions/search": subs,
  };
  return async (_method: string, path: string) => {
    if (!(path in routes)) throw new Error(`unexpected ${path}`);
    return routes[path];
  };
}

/** Sign-up state and PostHog, faked. */
function signUpDeps(over: Partial<SignUpDeps> = {}) {
  let signedUpAt: number | undefined;
  let pendingFlag = false;
  const sent: { event: string }[] = [];
  const d: SignUpDeps = {
    signedUpAt: async () => signedUpAt,
    markSignedUp: async (at) => void (signedUpAt = at),
    signUpPending: async () => pendingFlag,
    setSignUpPending: async (p) => void (pendingFlag = p),
    installId: async () => ID,
    send: async (body) => (sent.push(body), true),
    version: "1.0.5",
    now: () => 1_800_000_000_000,
    ...over,
  };
  return { d, sent, get signedUpAt() { return signedUpAt; }, get pending() { return pendingFlag; }, setSignedUpAt: (at: number) => void (signedUpAt = at) };
}

describe("signed_up", () => {
  it("goes out once when Vidzilla is installed, with the install ID as the person", async () => {
    const f = signUpDeps();
    expect(await noteInstalled(f.d)).toBe(true);
    expect(await retrySignUp(f.d)).toBe(false);
    expect(f.sent).toEqual([signedUpEvent(ID, "1.0.5", 1_800_000_000_000)]);
    expect(f.signedUpAt).toBe(1_800_000_000_000);
    expect(f.pending).toBe(false);
  });

  it("stays pending when sending failed and goes out on a later try", async () => {
    let ok = false;
    const f = signUpDeps({ send: async (body) => (ok && f.sent.push(body), ok) });
    expect(await noteInstalled(f.d)).toBe(false);
    expect(f.pending).toBe(true);
    ok = true;
    expect(await retrySignUp(f.d)).toBe(true);
    expect(f.sent.map((b) => b.event)).toEqual(["signed_up"]);
    expect(f.pending).toBe(false);
  });

  it("isn't sent again when the Chrome profile already signed up (a reinstall)", async () => {
    const f = signUpDeps();
    f.setSignedUpAt(1);
    expect(await noteInstalled(f.d)).toBe(false);
    expect(f.sent).toEqual([]);
    expect(f.pending).toBe(false);
  });

  it("isn't sent for an update or a restart without a pending install", async () => {
    const f = signUpDeps();
    expect(await signUpOnce(f.d)).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it("says it's an install, carries the product and version, and no location", () => {
    const body = signedUpEvent(ID, "1.0.5", 0);
    expect(body).toMatchObject({ api_key: POSTHOG_KEY, event: "signed_up", distinct_id: ID,
      properties: { product: "vidzilla", method: "extension_install", extension_version: "1.0.5", $geoip_disable: true } });
  });

  it("goes out before `activated` when it was still pending at the first save", async () => {
    const s = signUpDeps({ send: async () => false });
    await noteInstalled(s.d);
    const order: string[] = [];
    const signUp: SignUpDeps = { ...s.d, send: async (b) => (order.push(b.event), true) };
    const a = deps({ send: async (b) => (order.push(b.event), true) });
    expect(await noteActivated(a.d, signUp)).toBe(true);
    expect(order).toEqual(["signed_up", "activated"]);
  });
});

describe("paid", () => {
  const lifetime = { mode: "payment", amount_total: 900, currency: "usd", payment_intent: "pi_1", customer_details: { email: "a@b.co" }, metadata: { variant: "b" } };

  it("reports an install's first purchase in major units, with the buyer's email", async () => {
    const sale = await firstSale(stripeWith(lifetime, { data: [{ id: "pi_1", created: CREATED }] }), ID, SESSION, NOW);
    expect(sale).toEqual({ id: SESSION, plan: "lifetime", amount: 9, currency: "usd", email: "a@b.co", variant: "b", at: CREATED * 1000 });
    const e = paidEvent(ID, sale);
    expect(e).toMatchObject({ event: "paid", distinct_id: ID, timestamp: new Date(CREATED * 1000).toISOString() });
    expect(e.properties).toEqual({ product: "vidzilla", plan: "lifetime", amount: 9, currency: "usd", variant: "b", $geoip_disable: true, $set: { email: "a@b.co" } });
    // The same sale is always the same event, so a repeat is dropped.
    expect(paidEvent(ID, sale).uuid).toBe(e.uuid);
    expect(e.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("reports a subscription, without an email when Stripe has none", async () => {
    const sale = await firstSale(stripeWith({ mode: "subscription", amount_total: 700, currency: "usd", subscription: "sub_1" }, empty, { data: [{ id: "sub_1", created: CREATED }] }), ID, SESSION, NOW);
    expect(sale).toMatchObject({ plan: "subscription", amount: 7, currency: "usd", email: undefined });
    expect(paidEvent(ID, sale).properties.$set).toBeUndefined();
  });

  it("isn't reported when a launch code made the checkout free, as in Beans and Guppy", async () => {
    const free = stripeWith({ mode: "subscription", amount_total: 0, currency: "usd", subscription: "sub_1" }, empty, { data: [{ id: "sub_1", created: CREATED }] });
    expect(await firstSale(free, ID, SESSION, NOW)).toBeUndefined();
    expect(await firstSale(stripeWith({ ...lifetime, amount_total: 0, payment_intent: null, payment_status: "no_payment_required" }), ID, SESSION, NOW)).toBeUndefined();
  });

  it("isn't reported for a later purchase by the same install", async () => {
    const resubscribed = stripeWith({ mode: "subscription", amount_total: 99, currency: "usd", subscription: "sub_2" }, empty, {
      data: [{ id: "sub_1", created: CREATED - 86_400 * 400 }, { id: "sub_2", created: CREATED }],
    });
    expect(await firstSale(resubscribed, ID, SESSION, NOW)).toBeUndefined();
    const lifetimeAfterSub = stripeWith(lifetime, { data: [{ id: "pi_1", created: CREATED }] }, { data: [{ id: "sub_1", created: CREATED - 100 }] });
    expect(await firstSale(lifetimeAfterSub, ID, SESSION, NOW)).toBeUndefined();
  });

  it("isn't reported from an old thanks page, another install's checkout or an unfinished one", async () => {
    expect(await firstSale(stripeWith(lifetime), ID, SESSION, CREATED * 1000 + SALE_WINDOW_MS + 1)).toBeUndefined();
    expect(await firstSale(stripeWith({ ...lifetime, client_reference_id: "someone-else" }), ID, SESSION, NOW)).toBeUndefined();
    expect(await firstSale(stripeWith({ ...lifetime, status: "open" }), ID, SESSION, NOW)).toBeUndefined();
  });

  it("counts zero-decimal currencies as they are", () => {
    expect(majorUnits(999, "usd")).toBe(9.99);
    expect(majorUnits(1200, "jpy")).toBe(1200);
  });

  it("posts to PostHog's capture API, and a failure never reaches the license answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await capture({ event: "paid" }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(init.method).toBe("POST");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(reportSale(stripeWith(lifetime), ID, SESSION, async () => Promise.reject(new Error("down")))).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("makes stable, well-formed UUIDs", () => {
    expect(stableUuid("x")).toBe(stableUuid("x"));
    expect(stableUuid("x")).not.toBe(stableUuid("y"));
  });
});
