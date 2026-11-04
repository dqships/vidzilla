import { describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS Vercel module
import middleware, { reportPageView } from "../../middleware.js";
// @ts-expect-error plain JS Vercel function module
import { checkoutStartedEvent, POSTHOG_KEY, stableUuid } from "../../api/_posthog.js";
// @ts-expect-error plain JS Vercel function module
import { POST, reportCheckout } from "../../api/checkout.js";
// @ts-expect-error plain JS Vercel function module
import { storeRedirect } from "../../api/store-link.js";
// @ts-expect-error plain JS Vercel function module
import { isBot, pageViewEvent, storeClickEvent, visitorId } from "../../api/_web-analytics.js";
// @ts-expect-error plain JS site module
import { release } from "../../site/release.js";

const SITE = "https://vidzilla.followusai.com";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const NOW = Date.UTC(2026, 10, 4, 15, 30);
const ID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";
const session = { id: "cs_live_abcdefghijkl", url: "https://checkout.stripe.com/c/pay/cs_live_abcdefghijkl", created: 1_800_000_000, amount_total: 0, currency: "usd" };

/** A request as Vercel hands it over: the public host, the visitor's address in x-real-ip. */
function req(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request(SITE + path, { method, headers: { host: "vidzilla.followusai.com", "x-real-ip": "203.0.113.7", "user-agent": CHROME, accept: "text/html", ...headers } });
}

describe("page views", () => {
  it("reports a person opening a page as an anonymous $pageview", () => {
    const e = pageViewEvent(req("/pricing?utm_source=newsletter&utm_campaign=launch&id=" + ID, { referer: "https://www.google.com/search?q=vidzilla" }), NOW);
    expect(e).toEqual({
      api_key: POSTHOG_KEY,
      event: "$pageview",
      distinct_id: visitorId("203.0.113.7", CHROME, NOW),
      timestamp: new Date(NOW).toISOString(),
      properties: {
        product: "vidzilla",
        // The query is dropped except utm_*: the upgrade pages carry an install ID there.
        $current_url: `${SITE}/pricing?utm_source=newsletter&utm_campaign=launch`,
        $host: "vidzilla.followusai.com",
        $pathname: "/pricing",
        $referrer: "https://www.google.com/search",
        $referring_domain: "www.google.com",
        utm_source: "newsletter",
        utm_campaign: "launch",
        $lib: "server-pageview",
        $raw_user_agent: CHROME,
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    // The address is only ever hashed.
    expect(JSON.stringify(e)).not.toContain("203.0.113.7");
    expect(pageViewEvent(req("/"), NOW).properties).toMatchObject({ $pathname: "/", $referrer: "$direct", $referring_domain: "$direct" });
    expect(pageViewEvent(req("/upgrade-thanks?id=" + ID + "&session_id=cs_live_x"), NOW).properties.$current_url).toBe(`${SITE}/upgrade-thanks`);
  });

  it("skips bots, crawlers, link previews, scripts and headless browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "curl/8.5.0",
      "python-requests/2.32",
      "",
    ]) {
      expect(isBot(ua), ua).toBe(true);
      expect(pageViewEvent(req("/", { "user-agent": ua }), NOW), ua).toBeNull();
    }
    expect(isBot(CHROME)).toBe(false);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    // The one-off production check in the PR.
    expect(isBot("posthog-verify/1.0 (claude-code)")).toBe(false);
  });

  it("skips prefetches, prerenders and framework data requests", () => {
    for (const headers of <Record<string, string>[]>[{ purpose: "prefetch" }, { "sec-purpose": "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "x-moz": "prefetch" }, { "next-router-prefetch": "1" }, { rsc: "1" }, { "x-nextjs-data": "1" }]) {
      expect(pageViewEvent(req("/", headers), NOW), JSON.stringify(headers)).toBeNull();
    }
  });

  it("skips assets, the extension's ads.json, markdown, the API, HEAD requests and unknown pages", () => {
    for (const path of ["/styles.css", "/site.js", "/ads.json", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/llms.txt", "/index.md", "/pricing.html", "/api/license", "/go/chrome-web-store", "/wp-login", "/brand/og-image.png"]) {
      expect(pageViewEvent(req(path), NOW), path).toBeNull();
    }
    expect(pageViewEvent(req("/", { accept: "text/markdown" }), NOW)).toBeNull();
    expect(pageViewEvent(req("/", {}, "HEAD"), NOW)).toBeNull();
  });

  it("only counts the production site, not local builds or preview addresses", () => {
    expect(pageViewEvent(new Request("http://127.0.0.1:4173/", { headers: { "user-agent": CHROME } }), NOW)).toBeNull();
    expect(pageViewEvent(req("/", { host: "vidzilla-abc123.vercel.app" }), NOW)).toBeNull();
  });

  it("tells visitors apart with a hash that changes every day", () => {
    const today = visitorId("203.0.113.7", CHROME, NOW);
    expect(today).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId("203.0.113.7", CHROME, Date.UTC(2026, 10, 4, 23, 59))).toBe(today);
    expect(visitorId("203.0.113.7", CHROME, Date.UTC(2026, 10, 5, 0, 0))).not.toBe(today);
    expect(visitorId("203.0.113.8", CHROME, NOW)).not.toBe(today);
    expect(visitorId("203.0.113.7", "Firefox", NOW)).not.toBe(today);
  });

  it("is sent after the page from the middleware, and a PostHog failure never touches the page", async () => {
    const sent: unknown[] = [];
    const deferred: Promise<unknown>[] = [];
    expect(reportPageView(req("/"), { send: async (e: unknown) => void sent.push(e), defer: (p: Promise<unknown>) => void deferred.push(p), now: NOW })).toBe(true);
    await Promise.all(deferred);
    expect(sent).toHaveLength(1);
    expect(reportPageView(req("/styles.css"), { send: async (e: unknown) => void sent.push(e), defer: (p: Promise<unknown>) => void deferred.push(p) })).toBe(false);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: Promise<unknown>[] = [];
    expect(reportPageView(req("/"), { send: () => Promise.reject(new Error("down")), defer: (p: Promise<unknown>) => void failing.push(p) })).toBe(true);
    await expect(Promise.all(failing)).resolves.toBeDefined();
    expect(reportPageView(req("/"), { send: () => { throw new Error("sync"); }, defer: (p: Promise<unknown>) => void failing.push(p) })).toBe(true);
    await expect(Promise.all(failing)).resolves.toBeDefined();
    err.mockRestore();

    // The middleware passes the page through (no response of its own) and hands the view to waitUntil.
    const waited: Promise<unknown>[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    expect(middleware(req("/about"), { waitUntil: (p: Promise<unknown>) => void waited.push(p) })).toBeUndefined();
    await Promise.all(waited);
    expect(waited).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith("https://us.i.posthog.com/i/v0/e/", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ event: "$pageview", properties: { $pathname: "/about" } });
    fetchSpy.mockRestore();
  });
});

describe("store link", () => {
  const STORE = `${release.storeUrl}?utm_source=vidzilla.followusai.com&utm_medium=website`;

  it("goes to the listing in site/release.js with the site's utm tags", () => {
    expect(release.storeUrl).toBe("https://chromewebstore.google.com/detail/bmffjglgaejcnbjckhmppkbdcfgdnold");
    const res = storeRedirect(req("/go/chrome-web-store?from=home-hero"), { send: async () => {}, defer: () => {} });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(STORE);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the click with the button, the page it was on and its utm tags, under the page views' daily hash", async () => {
    const sent: unknown[] = [];
    const deferred: Promise<unknown>[] = [];
    const res = storeRedirect(req("/go/chrome-web-store?from=pricing-offer", { referer: `${SITE}/pricing?utm_source=reddit&id=${ID}` }), {
      send: async (e: unknown) => void sent.push(e),
      defer: (p: Promise<unknown>) => void deferred.push(p),
      now: NOW,
    });
    expect(res.status).toBe(302);
    await Promise.all(deferred);
    expect(sent).toEqual([
      {
        api_key: POSTHOG_KEY,
        event: "store_link_clicked",
        distinct_id: pageViewEvent(req("/pricing"), NOW).distinct_id,
        timestamp: new Date(NOW).toISOString(),
        properties: {
          product: "vidzilla",
          from: "pricing-offer",
          $current_url: `${SITE}/pricing?utm_source=reddit`,
          $pathname: "/pricing",
          $host: "vidzilla.followusai.com",
          $referrer: `${SITE}/pricing`,
          $referring_domain: "vidzilla.followusai.com",
          utm_source: "reddit",
          $lib: "server-redirect",
          $raw_user_agent: CHROME,
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ]);
  });

  it("prefers the link's own utm tags, and falls back to the referrer for the page", () => {
    const e = storeClickEvent(req("/go/chrome-web-store?utm_source=x&utm_medium=y", { referer: `${SITE}/?utm_source=ignored` }), NOW);
    expect(e.properties).toMatchObject({ from: "/", utm_source: "x", utm_medium: "y" });
    expect(storeClickEvent(req("/go/chrome-web-store"), NOW).properties).toMatchObject({ from: "unknown", $referrer: "$direct" });
  });

  it("still redirects, without reporting, for bots, prefetches, HEAD and other hosts", () => {
    const send = vi.fn();
    const defer = vi.fn();
    for (const r of [
      req("/go/chrome-web-store?from=x", { "user-agent": "Googlebot/2.1" }),
      req("/go/chrome-web-store?from=x", { "sec-purpose": "prefetch" }),
      req("/go/chrome-web-store?from=x", {}, "HEAD"),
      req("/go/chrome-web-store?from=x", { host: "vidzilla-abc.vercel.app" }),
    ]) {
      const res = storeRedirect(r, { send, defer });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(STORE);
    }
    expect(send).not.toHaveBeenCalled();
    expect(defer).not.toHaveBeenCalled();
  });

  it("always redirects, even when PostHog fails, throws or waitUntil does", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const deferred: Promise<unknown>[] = [];
    const defer = (p: Promise<unknown>) => void deferred.push(p);
    const send = vi.fn();
    for (const options of [
      { send: () => Promise.reject(new Error("PostHog 503")), defer },
      { send: () => { throw new Error("sync"); }, defer },
      { send: () => new Promise(() => {}), defer },
      { send, defer: () => { throw new Error("no context"); } },
    ]) {
      const res = storeRedirect(req("/go/chrome-web-store?from=home-hero"), options);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(STORE);
    }
    // The capture was handed off each time, and its failure was caught.
    expect(deferred).toHaveLength(3);
    await expect(Promise.all(deferred.slice(0, 2))).resolves.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe("checkout_started", () => {
  it("goes out under the install ID with the plan, the price group, the code and the amount", () => {
    const e = checkoutStartedEvent(ID, { session, plan: "lifetime", variant: "b", promoCode: "LAUNCH100" });
    expect(e).toEqual({
      api_key: POSTHOG_KEY,
      event: "checkout_started",
      distinct_id: ID,
      uuid: stableUuid("checkout_started:cs_live_abcdefghijkl"),
      timestamp: new Date(1_800_000_000_000).toISOString(),
      properties: { product: "vidzilla", plan: "lifetime", variant: "b", promo_code: "LAUNCH100", amount: 0, currency: "usd", $geoip_disable: true },
    });
    const full = checkoutStartedEvent(ID, { session: { ...session, amount_total: 99, currency: "USD" }, plan: "subscription", variant: "a" });
    expect(full.properties).toEqual({ product: "vidzilla", plan: "subscription", variant: "a", amount: 0.99, currency: "usd", $geoip_disable: true });
    // Without an amount from Stripe, none is guessed.
    expect(checkoutStartedEvent(ID, { session: { id: session.id }, plan: "lifetime" }).properties).toEqual({ product: "vidzilla", plan: "lifetime", $geoip_disable: true });
  });

  it("never fails the checkout when PostHog does", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(reportCheckout(ID, { session, plan: "lifetime" }, () => Promise.reject(new Error("down")))).resolves.toBeUndefined();
    err.mockRestore();
    const send = vi.fn(async () => {});
    await reportCheckout(ID, { session, plan: "lifetime", variant: "a" }, send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event: "checkout_started", distinct_id: ID }));
  });
});

describe("checkout API", () => {
  it("reports checkout_started once Stripe has made the session, with the code it applied", async () => {
    const env = { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_PRICE_SUBSCRIPTIONS: "price_s", STRIPE_PRICE_LIFETIME: "price_l", STRIPE_PROMO_CODES: "LAUNCH100" };
    Object.assign(process.env, env);
    const posthog: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://us.i.posthog.com/")) return posthog.push(JSON.parse(init!.body as string)), new Response("{}");
      const path = new URL(url).pathname;
      const body: Record<string, unknown> =
        path === "/v1/prices/price_s" ? { unit_amount: 99, currency: "usd", recurring: { interval: "year", interval_count: 1 } }
        : path === "/v1/prices/price_l" ? { unit_amount: 900, currency: "usd", recurring: null }
        : path === "/v1/promotion_codes" ? { data: [{ id: "promo_1", code: "LAUNCH100", active: true, times_redeemed: 3, max_redemptions: 100, coupon: { percent_off: 100, duration: "once", valid: true } }] }
        : path === "/v1/checkout/sessions" ? { ...session, amount_total: 0 }
        : {};
      return new Response(JSON.stringify(body));
    });
    try {
      const res = await POST(new Request(`${SITE}/api/checkout`, { method: "POST", body: JSON.stringify({ plan: "lifetime", id: ID }) }));
      expect(await res.json()).toEqual({ url: session.url });
      await vi.waitFor(() => expect(posthog).toHaveLength(1));
      expect(posthog[0]).toMatchObject({ event: "checkout_started", distinct_id: ID, properties: { plan: "lifetime", variant: "a", promo_code: "LAUNCH100", amount: 0, currency: "usd" } });
    } finally {
      fetchSpy.mockRestore();
      for (const key of Object.keys(env)) delete process.env[key];
    }
  });
});
