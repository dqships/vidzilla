// Ad-free purchases, server side. Stripe is the only record of who paid: a
// checkout carries the extension's random install ID in its metadata, and a
// license check searches Stripe for that ID. There is no database, and
// nothing about the buyer is kept here. See docs/ad-free-upgrade.md.

export const ORIGIN = "https://vidzilla.followusai.com";

/** Pinned so the fields read below don't move under us. */
const STRIPE_VERSION = "2024-06-20";

/** The extension makes one with crypto.randomUUID(). */
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export const isInstallId = (id) => typeof id === "string" && INSTALL_ID.test(id);
export const isSessionId = (id) => typeof id === "string" && SESSION_ID.test(id);

/** Flattens {a: {b: 1}} into Stripe's form encoding, a[b]=1. */
export function formEncode(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === "object") formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

/** A Stripe API caller: stripe("GET", "/v1/...", params). */
export function stripeClient(secretKey, fetchImpl = fetch) {
  return async (method, path, params = {}) => {
    const body = formEncode(params);
    const url = method === "GET" ? `https://api.stripe.com${path}?${body}` : `https://api.stripe.com${path}`;
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": STRIPE_VERSION,
        ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: method === "GET" ? undefined : body,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`);
    return json;
  };
}

/**
 * The Checkout Session that sells one of the two plans to one install, at
 * the prices of its test group (see _prices.js). The group goes on the
 * payment too, so sales can be compared per group in Stripe. With an offer
 * running (see _promos.js) its promotion code is applied for the buyer;
 * otherwise they can enter one made from a Stripe coupon. Stripe allows one
 * or the other, not both.
 */
export function checkoutParams(plan, installId, offer, promoId) {
  const tags = { install_id: installId, variant: offer.variant };
  const common = {
    client_reference_id: installId,
    metadata: { ...tags, plan },
    ...(promoId ? { discounts: { 0: { promotion_code: promoId } } } : { allow_promotion_codes: true }),
    success_url: `${ORIGIN}/upgrade-thanks?id=${installId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ORIGIN}/upgrade?id=${installId}`,
  };
  if (plan === "subscription") {
    return {
      ...common,
      mode: "subscription",
      line_items: { 0: { quantity: 1, price: offer.priceIds.subscription } },
      subscription_data: { metadata: tags },
    };
  }
  return {
    ...common,
    mode: "payment",
    customer_creation: "always",
    line_items: { 0: { quantity: 1, price: offer.priceIds.lifetime } },
    payment_intent_data: { metadata: tags },
  };
}

const LIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due"]);

/** A subscription's period end in ms; newer API versions keep it on the item. */
function periodEnd(sub) {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end * 1000 : null;
}

const NONE = { adFree: false };

/**
 * Has this install paid? With the session ID from the thanks page, the answer
 * comes from that checkout directly (search lags behind by up to a minute).
 * The extension keeps that ID and sends it with every later check too, which
 * is the only record of a one-time purchase a 100% off coupon made free (no
 * payment exists to search for). Otherwise Stripe is searched for a live
 * subscription or a paid, unrefunded one-time payment carrying the install ID.
 */
export async function checkLicense(stripe, installId, sessionId) {
  if (sessionId) {
    const session = await stripe("GET", `/v1/checkout/sessions/${sessionId}`, { expand: ["subscription", "payment_intent.latest_charge"] });
    if (session.client_reference_id === installId && session.status === "complete" && session.payment_status !== "unpaid") {
      const sub = session.subscription;
      if (session.mode === "subscription" && sub && LIVE_SUBSCRIPTION.has(sub.status)) {
        return { adFree: true, plan: "subscription", until: periodEnd(sub) };
      }
      if (session.mode === "payment") {
        // A 100% off code leaves nothing to pay, so there's no PaymentIntent:
        // Stripe marks such a session "paid" with a total of 0 (or, in some
        // versions, "no_payment_required").
        const free = session.payment_status === "no_payment_required" || (session.amount_total === 0 && !session.payment_intent);
        const charge = session.payment_intent?.latest_charge;
        if (free || (session.payment_intent?.status === "succeeded" && !charge?.refunded)) return { adFree: true, plan: "lifetime", until: null };
      }
    }
  }

  const id = installId.replace(/'/g, "");
  const payments = await stripe("GET", "/v1/payment_intents/search", {
    query: `metadata['install_id']:'${id}' AND status:'succeeded'`,
    expand: ["data.latest_charge"],
  });
  if (payments.data.some((pi) => !pi.latest_charge?.refunded)) return { adFree: true, plan: "lifetime", until: null };

  const subs = await stripe("GET", "/v1/subscriptions/search", { query: `metadata['install_id']:'${id}'` });
  const live = subs.data.filter((s) => LIVE_SUBSCRIPTION.has(s.status));
  if (live.length) {
    const until = Math.max(...live.map((s) => periodEnd(s) ?? 0));
    return { adFree: true, plan: "subscription", until: until || null };
  }
  return NONE;
}

/** A thanks page older than this no longer reports its sale (a bookmark, a reopened tab). */
export const SALE_WINDOW_MS = 24 * 3_600_000;

/** Currencies Stripe counts in whole units: no cents to divide by. */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** Stripe's amount (cents) in major units: 900 usd is 9. */
export function majorUnits(amount, currency) {
  return ZERO_DECIMAL.has(currency) ? amount : amount / 100;
}

/**
 * The sale a thanks page's checkout made, for the `paid` analytics event
 * (api/_posthog.js): {id, plan, amount, currency, email, variant, at}, or
 * undefined when it isn't this install's first charge. A later purchase by
 * the same install (a new subscription after one lapsed, lifetime after a
 * subscription) finds the earlier charge (chargedBefore). A checkout that
 * charged nothing (a 100% off launch code) isn't a sale, as in Beans and
 * Guppy; the first renewal that charges is (invoiceSale). The amount is what
 * the checkout charged, discounts included.
 */
export async function firstSale(stripe, installId, sessionId, now = Date.now()) {
  const session = await stripe("GET", `/v1/checkout/sessions/${sessionId}`);
  if (session.client_reference_id !== installId) return undefined;
  if (now - session.created * 1000 > SALE_WINDOW_MS) return undefined;
  return saleOf(stripe, { ...session, id: session.id ?? sessionId });
}

/**
 * Did Vidzilla's checkout make this session? The Stripe account is shared
 * with other products, and only Vidzilla tags a checkout with an install ID
 * (checkoutParams above).
 */
export function isVidzillaSession(session) {
  const installId = session?.client_reference_id;
  return isInstallId(installId) && session.metadata?.install_id === installId && (!session.metadata?.app || session.metadata.app === "vidzilla");
}

/** Did Vidzilla's checkout make this subscription? It carries the install ID (subscription_data above). */
export function isVidzillaSubscription(sub) {
  return isInstallId(sub?.metadata?.install_id) && (!sub.metadata.app || sub.metadata.app === "vidzilla");
}

/**
 * The sale a finished checkout made, as firstSale() describes, for the thanks
 * page and the Stripe webhook alike (api/stripe-webhook.js), so both report
 * the same sale as the same event. Undefined while it's unpaid or when the
 * install bought before.
 */
export async function saleOf(stripe, session) {
  const installId = session.client_reference_id;
  if (!isInstallId(installId) || session.status !== "complete" || session.payment_status === "unpaid") return undefined;
  // Nothing was charged (a 100% off launch code): not a sale, as Beans and Guppy count it.
  if (!(typeof session.amount_total === "number" && session.amount_total > 0)) return undefined;
  if (await chargedBefore(stripe, installId, session.created, { paymentIntent: session.payment_intent })) return undefined;
  const currency = String(session.currency ?? "usd").toLowerCase();
  return {
    id: session.id,
    plan: session.mode === "subscription" ? "subscription" : "lifetime",
    amount: majorUnits(session.amount_total, currency),
    currency,
    email: session.customer_details?.email ?? undefined,
    variant: session.metadata?.variant,
    at: session.created * 1000,
  };
}

/**
 * Was this install charged money before `beforeS` (seconds)? A paid lifetime
 * payment carrying its install ID, or a paid invoice above 0 on one of its
 * subscriptions. A checkout or invoice a 100% off code made free doesn't
 * count, so the first real charge after one is still the first sale.
 * `paymentIntent` and `invoice` name the charge being judged, left out.
 */
export async function chargedBefore(stripe, installId, beforeS, { paymentIntent, invoice } = {}) {
  const id = installId.replace(/'/g, "");
  const [payments, subs] = await Promise.all([
    stripe("GET", "/v1/payment_intents/search", { query: `metadata['install_id']:'${id}' AND status:'succeeded'` }),
    stripe("GET", "/v1/subscriptions/search", { query: `metadata['install_id']:'${id}'` }),
  ]);
  const before = (x) => typeof x.created === "number" && x.created < beforeS;
  if (payments.data.some((pi) => pi.id !== paymentIntent && before(pi) && (pi.amount_received ?? pi.amount ?? 0) > 0)) return true;
  for (const sub of subs.data.filter(before)) {
    const invoices = await stripe("GET", "/v1/invoices", { subscription: sub.id, status: "paid", limit: 100 });
    if (invoices.data.some((inv) => inv.id !== invoice && before(inv) && inv.amount_paid > 0)) return true;
  }
  return false;
}

/** The subscription an invoice bills, and its metadata when the event carries it (API versions put it in different places). */
function invoiceSubscription(invoice) {
  const details = invoice.parent?.subscription_details ?? invoice.subscription_details ?? {};
  const sub = invoice.subscription ?? details.subscription;
  const id = typeof sub === "string" ? sub : sub?.id;
  const metadata = details.metadata && Object.keys(details.metadata).length ? details.metadata : typeof sub === "object" ? sub?.metadata : undefined;
  return { id, metadata };
}

/**
 * The sale a paid subscription invoice made, for `paid`, when it's the
 * install's first real charge: a renewal after a launch code that made the
 * first periods free. The first invoice of a subscription is left to its
 * checkout (saleOf), which reports the same charge. Undefined for anything
 * else: no charge, not Vidzilla's, or charged before.
 */
export async function invoiceSale(stripe, invoice) {
  if (invoice?.billing_reason === "subscription_create") return undefined;
  if (!(typeof invoice?.amount_paid === "number" && invoice.amount_paid > 0)) return undefined;
  const { id: subscriptionId, metadata } = invoiceSubscription(invoice);
  if (!subscriptionId) return undefined;
  const sub = metadata ? { id: subscriptionId, metadata } : await stripe("GET", `/v1/subscriptions/${subscriptionId}`);
  if (!isVidzillaSubscription(sub)) return undefined;
  const installId = sub.metadata.install_id;
  const created = invoice.created;
  if (await chargedBefore(stripe, installId, created, { invoice: invoice.id })) return undefined;
  const currency = String(invoice.currency ?? "usd").toLowerCase();
  const paidAt = invoice.status_transitions?.paid_at ?? created;
  return {
    installId,
    id: invoice.id,
    plan: "subscription",
    amount: majorUnits(invoice.amount_paid, currency),
    currency,
    email: invoice.customer_email ?? undefined,
    variant: typeof sub.metadata.variant === "string" ? sub.metadata.variant : undefined,
    at: paidAt * 1000,
  };
}

/**
 * A Vidzilla subscription that has ended, reduced to what
 * `subscription_cancelled` needs (api/_posthog.js), or null while it's still
 * running or never started (`incomplete_expired`). `reason` is Stripe's
 * `cancellation_details.reason` (cancellation_requested, payment_failed,
 * payment_disputed) and `feedback` the reason picked in the customer portal
 * (too_expensive, missing_features...); the free-text comment is left out.
 * `daysSubscribed` counts from the start, trial included, to the end. The
 * same shape as Beans and Guppy send.
 */
export function endedSubscription(sub, nowS = Math.floor(Date.now() / 1000)) {
  if (sub?.status !== "canceled" || !isVidzillaSubscription(sub)) return null;
  const seconds = (value) => (typeof value === "number" ? value : null);
  const start = seconds(sub.start_date) ?? seconds(sub.created);
  const end = seconds(sub.ended_at) ?? seconds(sub.canceled_at) ?? nowS;
  const trialEnd = seconds(sub.trial_end);
  const details = sub.cancellation_details ?? {};
  return {
    subscriptionId: String(sub.id),
    installId: sub.metadata.install_id,
    variant: typeof sub.metadata.variant === "string" ? sub.metadata.variant : undefined,
    reason: typeof details.reason === "string" ? details.reason : null,
    feedback: typeof details.feedback === "string" ? details.feedback : null,
    daysSubscribed: start === null ? null : Math.max(0, Math.round((end - start) / 86_400)),
    endedInTrial: trialEnd !== null && end <= trialEnd,
    at: end * 1000,
  };
}

/**
 * Vidzilla's own customer portal configuration ("Vidzilla", live mode): its
 * headline and return address, and the cancellation reasons that
 * `subscription_cancelled` reports. The account's default one belongs to
 * all the products sharing the Stripe account.
 */
export const PORTAL_CONFIGURATION = "bpc_1UZA0DDyfH6JDnExHm1XDQLR";

/**
 * A Stripe customer portal session for this install's subscription, where the
 * buyer can cancel it or change the card. The install ID finds the customer
 * through the subscription's metadata; undefined when it has no plan.
 */
export async function portalSession(stripe, installId) {
  const id = installId.replace(/'/g, "");
  const subs = await stripe("GET", "/v1/subscriptions/search", { query: `metadata['install_id']:'${id}'` });
  // The newest plan this install has, live ones first.
  const [sub] = [...subs.data].sort((a, b) => Number(LIVE_SUBSCRIPTION.has(b.status)) - Number(LIVE_SUBSCRIPTION.has(a.status)) || b.created - a.created);
  const customer = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  if (!customer) return undefined;
  const session = await stripe("POST", "/v1/billing_portal/sessions", { customer, configuration: PORTAL_CONFIGURATION, return_url: ORIGIN });
  return session.url;
}

export function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}
