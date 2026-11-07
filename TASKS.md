# Tasks

## Next

- Stripe webhook (live mode): Developers, Webhooks, Add destination, endpoint
  `https://vidzilla.followusai.com/api/stripe-webhook`, events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `customer.subscription.deleted`. Put its signing secret in Vercel as
  `STRIPE_WEBHOOK_SECRET` (Production, Secret) and redeploy. Details in
  `docs/ad-free-upgrade.md` (Settings it needs).
- After the first real sale or cancellation, check PostHog 708991 for one
  `paid` / `subscription_cancelled` with `product: "vidzilla"`.

## Decisions

- 2026-11-06: Keep sending `paid` for a $0 checkout (100% off launch code),
  with `amount: 0`, from both the thanks page and the Stripe webhook. Beans
  and Guppy skip $0 invoices, so the weekly report counts Vidzilla's free
  claims as paid and theirs not; that difference is accepted.

## Done

- 2026-11-06: Stripe webhook for PostHog (`api/stripe-webhook.js`): `paid` on
  an install's first purchase from `checkout.session.completed` /
  `async_payment_succeeded`, so buyers who close the tab are counted (same
  uuid and timestamp as the thanks page's report, so one event), and
  `subscription_cancelled` on `customer.subscription.deleted` with Beans' and
  Guppy's properties. Ignores other products on the shared Stripe account and
  test mode. Privacy policy updated (effective 6 November 2026). Checked why
  `checkout_started`, `activated` and `paid` never arrived: no bug. Extension
  1.0.5 is published (Chrome Web Store, updated 2026-11-04, 4 users), so the
  "not yet uploaded" note below is out of date. The last Vidzilla checkout in
  Stripe was 2026-10-30, before those events shipped on 2026-11-04, and
  `activated` needs a new install's first saved file.
- 2026-11-06: IndexNow for vidzilla.followusai.com. The key file is `site/d21121a4676e4e52992abb4e767de470.txt` (copied to the site root by `scripts/build-site.mjs`), and `.github/workflows/indexnow.yml` runs `scripts/indexnow.mjs` after every successful Vercel production deploy, sending every page in the live sitemap to Bing and the other IndexNow engines. Previews and local builds never send. Check Bing Webmaster Tools → IndexNow a day after the first production deploy.
- 2026-11-04: Website and checkout analytics in PostHog (project 708991),
  without touching the extension (1.0.5 stays as published). Server-side
  anonymous `$pageview` from `middleware.js` and `store_link_clicked` from
  the new `/go/chrome-web-store` redirect (`api/store-link.js`, 302 to the
  listing with `utm_source=vidzilla.followusai.com&utm_medium=website`), both
  under a daily hash with no person profiles; the site still has no PostHog
  script and no cookies. `checkout_started` from `api/checkout.js` under the
  install ID. Privacy policy updated. `checkout_started` still needs a real
  checkout to be seen in PostHog.
- 2026-11-04: `signed_up` on a new install (`method: "extension_install"`,
  service worker, `src/sw/analytics.ts`), retried at startup if PostHog was
  unreachable. Privacy policy now also discloses the install event and the
  website's Vercel Web Analytics. "Discard client IP data" turned on in
  PostHog project 708991. Still ships as 1.0.5 (not yet uploaded).
- 2026-11-04: PostHog product analytics (project 708991). `activated` on an
  install's first saved file (service worker, `src/sw/analytics.ts`) and
  `paid` on a first purchase (`api/license.js`, from the thanks page), both
  under the install ID; no `signed_up`, since there are no accounts. Privacy
  policy, pricing and home page copy and the store listing notes updated.
  Extension bumped to 1.0.5: upload it and update the Privacy practices tab
  (`store/README.md`).

- 2026-11-03: Site icons for search and browsers. `scripts/make-brand.mjs` now
  also makes `brand/favicon.ico` (16, 32, 48 px), `app-icon-96.png`,
  `app-icon-192.png` and `apple-touch-icon.png` (180 px) from the app icon; the
  site build serves `/favicon.ico` and `/apple-touch-icon.png` at the root, and
  every page links the ICO (48x48), the SVG, the 96 and 192 px PNGs and the
  apple touch icon. Checked locally with `pnpm site:serve`; after merging,
  request indexing of https://vidzilla.followusai.com/ in Google Search Console.
