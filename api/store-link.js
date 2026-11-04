// GET /go/chrome-web-store[?from=<button>]   (vercel.json rewrites it here)
// Every "Add to Chrome" link on the site points here. It sends the visitor on
// to the Chrome Web Store listing (site/release.js) with the site's utm tags,
// and reports the click to PostHog as `store_link_clicked` once the redirect
// has gone out (api/_web-analytics.js). The redirect never waits for PostHog
// and never fails because of it.
import { waitUntil } from "@vercel/functions";
import { release } from "../site/release.js";
import { capture } from "./_posthog.js";
import { storeClickEvent, storeTarget } from "./_web-analytics.js";

/** The redirect, and the click report handed to `defer` (Vercel's waitUntil) so it runs after. */
export function storeRedirect(request, { send = capture, defer = waitUntil, now = Date.now() } = {}) {
  let location = release.storeUrl;
  try {
    location = storeTarget(release.storeUrl);
    const event = storeClickEvent(request, now);
    if (event) {
      const report = Promise.resolve()
        .then(() => send(event))
        .catch((err) => console.error("store_link_clicked failed", err));
      try {
        defer(report);
      } catch (err) {
        console.error("waitUntil failed", err);
      }
    }
  } catch (err) {
    console.error("store link failed", err);
  }
  // Not cached, so every click reaches this function.
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

export const GET = (request) => storeRedirect(request);
export const HEAD = (request) => storeRedirect(request);
