// Website analytics, server side: an anonymous `$pageview` for each page a
// person opens (middleware.js) and `store_link_clicked` for each "Add to
// Chrome" click (api/store-link.js), sent to PostHog with capture() from
// api/_posthog.js. The site itself stays as it was: no PostHog script, no
// cookies. A visitor is a hash of their IP address and browser that changes
// every day (UTC); the address itself is never sent. No person profiles are
// made for these events.
// See docs/ad-free-upgrade.md#analytics.
import { createHash } from "node:crypto";
import { origin, pages } from "../site/pages.mjs";
import { POSTHOG_KEY } from "./_posthog.js";

const SITE_HOST = new URL(origin).host;

/** Not secret: it only keeps these hashes apart from other sites' hashes. */
const SALT = "vidzilla-website";

/** Pages counted as views: the listed ones plus the thanks page after a purchase. */
const PAGE_PATHS = new Set([...pages.map((p) => p.path), "/upgrade-thanks"]);

/** Crawlers, link previews, monitors, scripts and headless browsers. */
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|scrap|archiver|facebookexternalhit|meta-externalagent|embedly|preview|whatsapp|telegram|discord|slack|skype|vkshare|pinterest|redditbot|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|monitor|curl\/|wget|httpie|python|aiohttp|httpx|go-http-client|java\/|okhttp|axios|node-fetch|undici|node\.js|libwww|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexity|ccbot|cohere|diffbot|amazonbot|applebot|yandex|baidu|duckduck|sogou|exabot|seznam|mediapartners|adsbot|google-inspectiontool|googleother|feedfetcher|validator|vercel-(screenshot|favicon)/i;

export const isBot = (userAgent) => !userAgent || BOT.test(userAgent);

/** Link prefetches and prerenders, and framework data requests: nobody saw a page. */
export function isPrefetch(headers) {
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  return /prefetch|prerender|preview/i.test(purpose) || headers.has("next-router-prefetch") || headers.has("rsc") || headers.has("x-nextjs-data");
}

/** Only the production site counts: not local builds, previews or vercel.app addresses. */
export function onSite(request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return host === SITE_HOST;
}

/** The visitor's address, as Vercel passes it on. Only ever hashed. */
export function clientIp(headers) {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

/** The same visitor gets the same ID all day (UTC) and a new one the next. */
export function visitorId(ip, userAgent, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return createHash("sha256").update(`${SALT}\n${day}\n${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** The utm_* values of a URL's query. */
export function utms(url) {
  const out = {};
  for (const key of UTM) {
    const value = url.searchParams.get(key);
    if (value) out[key] = value.slice(0, 200);
  }
  return out;
}

/** A URL without its query, except utm_*: the upgrade pages carry an install ID and a checkout ID there. */
export function cleanUrl(url) {
  const clean = new URL(url.pathname, url.origin);
  for (const [key, value] of Object.entries(utms(url))) clean.searchParams.set(key, value);
  return clean.href;
}

function readUrl(text) {
  try {
    return text ? new URL(text) : undefined;
  } catch {
    return undefined;
  }
}

/** PostHog's referrer properties; a referrer's query and fragment are dropped. */
function referrerProps(referrer) {
  if (!referrer) return { $referrer: "$direct", $referring_domain: "$direct" };
  return { $referrer: `${referrer.origin}${referrer.pathname}`, $referring_domain: referrer.host };
}

function webEvent(event, request, now, properties) {
  const userAgent = request.headers.get("user-agent") ?? "";
  return {
    api_key: POSTHOG_KEY,
    event,
    distinct_id: visitorId(clientIp(request.headers), userAgent, now),
    timestamp: new Date(now).toISOString(),
    properties: {
      product: "vidzilla",
      ...properties,
      $raw_user_agent: userAgent,
      // Anonymous visitors: no person profile for each daily hash.
      $process_person_profile: false,
      // The request comes from Vercel, whose address says nothing about the visitor.
      $geoip_disable: true,
    },
  };
}

/** Is this request a person opening one of the site's pages? */
export function isPageView(request) {
  if (request.method !== "GET") return false;
  if (!onSite(request)) return false;
  const { pathname } = new URL(request.url);
  // Assets, ads.json, robots.txt, .md twins and /x.html (which redirects to /x).
  if (/\.[^/]*$/.test(pathname)) return false;
  if (!PAGE_PATHS.has(pathname.replace(/(.)\/$/, "$1"))) return false;
  if (/text\/markdown/i.test(request.headers.get("accept") ?? "")) return false;
  if (isPrefetch(request.headers)) return false;
  return !isBot(request.headers.get("user-agent"));
}

/** The `$pageview` for a page request, or null when it isn't one (see isPageView). */
export function pageViewEvent(request, now = Date.now()) {
  if (!isPageView(request)) return null;
  const url = new URL(request.url);
  return webEvent("$pageview", request, now, {
    $current_url: cleanUrl(url),
    $host: url.host,
    $pathname: url.pathname,
    ...referrerProps(readUrl(request.headers.get("referer"))),
    ...utms(url),
    $lib: "server-pageview",
  });
}

/** The fixed tags the store link adds, so the Chrome Web Store's own stats see the site as the source. */
export const STORE_UTM = { utm_source: SITE_HOST, utm_medium: "website" };

/** The listing URL with the site's utm tags. */
export function storeTarget(storeUrl) {
  const url = new URL(storeUrl);
  for (const [key, value] of Object.entries(STORE_UTM)) url.searchParams.set(key, value);
  return url.href;
}

/**
 * `store_link_clicked` for a click on /go/chrome-web-store, or null when a
 * bot, a prefetch or a request off the production site followed the link.
 * `from` names the button (home-hero, pricing-offer...); the page it was on
 * comes from the referrer, and utm_* from the link or, failing that, from
 * the page the visitor landed on.
 */
export function storeClickEvent(request, now = Date.now()) {
  if (request.method !== "GET" || !onSite(request) || isPrefetch(request.headers) || isBot(request.headers.get("user-agent"))) return null;
  const url = new URL(request.url);
  const referrer = readUrl(request.headers.get("referer"));
  const fromSite = referrer?.host === SITE_HOST;
  const from = url.searchParams.get("from")?.slice(0, 100) || (fromSite ? referrer.pathname : "unknown");
  const linkUtms = utms(url);
  return webEvent("store_link_clicked", request, now, {
    from,
    ...(fromSite ? { $current_url: cleanUrl(referrer), $pathname: referrer.pathname, $host: referrer.host } : {}),
    ...referrerProps(referrer),
    ...(Object.keys(linkUtms).length ? linkUtms : fromSite ? utms(referrer) : {}),
    $lib: "server-redirect",
  });
}
