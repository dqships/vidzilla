# Tasks

## Done

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
