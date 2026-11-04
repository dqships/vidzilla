// Vercel Routing Middleware, for the site's pages:
// - Markdown content negotiation. A request whose Accept header asks for
//   text/markdown gets the page's markdown twin at the same URL (or a
//   markdown 404); everything else goes on to the static site.
// - Page views. A person opening a page is reported to PostHog as an
//   anonymous `$pageview` after the response goes out (waitUntil), so the
//   site needs no script and sets no cookies. Bots, prefetches, assets and
//   markdown aren't counted (api/_web-analytics.js).
import { rewrite, waitUntil } from "@vercel/functions";
import { capture } from "./api/_posthog.js";
import { pageViewEvent } from "./api/_web-analytics.js";
import { notFoundMarkdown, pages } from "./site/pages.mjs";

export const config = {
  // Node.js (Vercel's default), stated because the page views hash with node:crypto.
  runtime: "nodejs",
  // Skip the asset folders, the API and the store link (api/store-link.js);
  // other files are skipped below.
  matcher: ["/((?!design/|brand/|api/|go/).*)"],
};

const byPath = new Map(pages.map((p) => [p.path, p.file]));

const MARKDOWN = { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" };

export function wantsMarkdown(accept) {
  return /(^|,)\s*text\/markdown\s*(?!;\s*q=0(\.0*)?\s*(,|$))/i.test(accept ?? "");
}

export function pageFile(pathname) {
  const path = pathname.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/$/, "$1");
  return byPath.get(path);
}

/** Hands the page view, if this request is one, to `defer`; never throws or delays the page. */
export function reportPageView(request, { send = capture, defer = waitUntil, now = Date.now() } = {}) {
  try {
    const event = pageViewEvent(request, now);
    if (!event) return false;
    defer(Promise.resolve().then(() => send(event)).catch((err) => console.error("$pageview failed", err)));
    return true;
  } catch (err) {
    console.error("$pageview failed", err);
    return false;
  }
}

export default function middleware(request, context) {
  if (!wantsMarkdown(request.headers.get("accept"))) {
    reportPageView(request, context?.waitUntil ? { defer: (p) => context.waitUntil(p) } : {});
    return;
  }
  const url = new URL(request.url);
  if (/\.(?!html$)[^/]*$/.test(url.pathname)) return;
  const file = pageFile(url.pathname);
  if (!file) return new Response(notFoundMarkdown, { status: 404, headers: { ...MARKDOWN, "X-Content-Type-Options": "nosniff" } });
  return rewrite(new URL(`/${file}.md`, url), { headers: MARKDOWN });
}
