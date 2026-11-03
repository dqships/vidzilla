# Tasks

## Done

- 2026-11-03: Site icons for search and browsers. `scripts/make-brand.mjs` now
  also makes `brand/favicon.ico` (16, 32, 48 px), `app-icon-96.png`,
  `app-icon-192.png` and `apple-touch-icon.png` (180 px) from the app icon; the
  site build serves `/favicon.ico` and `/apple-touch-icon.png` at the root, and
  every page links the ICO (48x48), the SVG, the 96 and 192 px PNGs and the
  apple touch icon. Checked locally with `pnpm site:serve`; after merging,
  request indexing of https://vidzilla.followusai.com/ in Google Search Console.
