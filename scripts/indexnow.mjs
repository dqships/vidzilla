// Tells IndexNow (Bing, Yandex, Seznam, Naver, ...) that this site's pages changed.
// Runs from .github/workflows/indexnow.yml after each successful production deploy,
// so the sitemap it reads is the one now live. Never exits non-zero: a failed ping
// is logged, not fatal. `node scripts/indexnow.mjs --dry-run` lists the URLs without sending.

const HOST = "vidzilla.followusai.com";
const KEY = "d21121a4676e4e52992abb4e767de470";
const ORIGIN = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;
const NON_PAGE = /(\.(md|txt|xml|json|pdf|rss|atom)$)|\/llms(-full)?\.txt$/i;

const dryRun = process.argv.includes("--dry-run");

async function get(url) {
  const res = await fetch(url, { headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

const locs = (xml) =>
  [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );

/** Every <loc> in the sitemap, following a sitemap index (one level of nesting is all these sites use, but recurse anyway). */
async function sitemapUrls(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const xml = await get(url);
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const nested = await Promise.all(locs(xml).map((child) => sitemapUrls(child, seen).catch((err) => (console.warn(`IndexNow: skipped ${child}: ${err.message}`), []))));
    return nested.flat();
  }
  return locs(xml);
}

function pageUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.host !== HOST) return null;
    if (NON_PAGE.test(url.pathname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function main() {
  const urls = [...new Set((await sitemapUrls(`${ORIGIN}/sitemap.xml`)).map(pageUrl).filter(Boolean))];
  if (urls.length === 0) {
    console.log("IndexNow: the sitemap has no URLs on", HOST, "- nothing to submit.");
    return;
  }
  if (dryRun) {
    console.log(`IndexNow (dry run): would submit ${urls.length} URL(s) for ${HOST}:\n${urls.join("\n")}`);
    return;
  }
  for (let i = 0; i < urls.length; i += MAX_URLS) {
    const urlList = urls.slice(i, i + MAX_URLS);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList }),
      signal: AbortSignal.timeout(30_000),
    });
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    if (res.status === 200 || res.status === 202) {
      console.log(`IndexNow: submitted ${urlList.length} URL(s) for ${HOST} (HTTP ${res.status}).`);
    } else {
      const hint = { 400: "bad request", 403: "key file missing or doesn't match the key", 422: "URLs don't match the host or key", 429: "too many requests" }[res.status] ?? "unexpected response";
      console.error(`IndexNow: HTTP ${res.status} (${hint}) for ${HOST}. ${detail}`);
    }
  }
}

main().catch((err) => console.error("IndexNow: submission failed:", err?.message ?? err));
