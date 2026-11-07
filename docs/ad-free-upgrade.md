# Ad-free upgrade

Vidzilla without ads is a **subscription** (its price is under an A/B/C test,
see below) or **$9 once**, paid through Stripe in the **FollowUs AI** Stripe
account (FollowUs AI LLC). Every feature stays free; paying only turns the
house ads off (see [house-ads.md](house-ads.md)).

## How it works

```
Extension                    Website (Vercel)                Stripe
---------                    ----------------                ------
install ID (random UUID,
chrome.storage.sync)
  "Remove ads" ─────────────► /upgrade?id=<installId>
                              GET /api/prices?id ───────────► reads the prices
                              button ─► POST /api/checkout ─► Checkout Session
                                                              (install ID in
                                                              metadata)
                              /upgrade-thanks ◄────────────── buyer pays
  sees the thanks page ─────► GET /api/license?id&session ──► reads that session
  daily ────────────────────► GET /api/license?id ──────────► searches payments
                                                              and subscriptions
  ◄──────────── {adFree, plan, until}
```

- **Stripe is the only record.** The server keeps no database. A purchase
  carries the install ID in its metadata (`install_id` on the Checkout
  Session, the subscription and the payment), and a license check searches
  Stripe for it. The decision recorded on 27 October 2026 was "option A, our
  own small Vercel server"; the server is the two functions below, and
  Upstash turned out to be unnecessary.
- **The install ID** is made with `crypto.randomUUID()` the first time it's
  needed and kept in `chrome.storage.sync`, so it follows the person's Chrome
  profile to their other computers. It identifies nobody. It is also the
  person in product analytics (PostHog), see below.
- **When the extension checks:** at once when the website's
  `/upgrade-thanks` page opens (the page carries the Checkout Session ID,
  which confirms the purchase without waiting for Stripe's search index),
  when the person presses **Check again** in Settings, under Ads, and once a
  day after that, but only while the copy is paid (on a completed download or
  a browser start, when the last answer is 24 hours old). Free copies never
  check on their own, so the server's Stripe searches scale with paying
  users, not installs. A paid answer also writes `paidAt` to
  `chrome.storage.sync`; other computers on the same Chrome profile see it
  and check at once, then every 10 minutes (on a download or browser start)
  until Stripe says yes. A "no" clears `paidAt` only once it is a day old,
  since Stripe's search can lag a fresh purchase. A failed check keeps the
  last answer.
- **The kept checkout:** the extension keeps the Checkout Session ID that
  confirmed a purchase (`paidSession` in `chrome.storage.sync`) and sends it
  with every check. That is what keeps a purchase that a 100% off coupon made
  free counted: Stripe makes no payment for it, so the payment search finds
  nothing, but the session says `no_payment_required`. The session path still
  checks for a refund (lifetime) or a lapsed subscription, and the extension
  drops the kept session once the answer is no.
- **Cancelling or changing the card:** on a subscription, **Manage** in
  Settings calls `POST /api/portal` with the install ID. The server finds
  the customer from the subscription's metadata and opens a Stripe customer
  portal session with Vidzilla's own portal configuration
  (`PORTAL_CONFIGURATION` in `api/_stripe.js`; return address: the website's
  home page).
- **Subscriptions** stay ad-free while the subscription is `active`,
  `trialing` or `past_due`, until the paid period ends. **Lifetime** stays
  ad-free unless the payment is refunded.

| Piece | File |
| --- | --- |
| Start a checkout | `api/checkout.js` (`POST {plan, id}` → `{url}`) |
| License check | `api/license.js` (`GET ?id=&session=` → `{adFree, plan, until}`) |
| Prices | `api/prices.js` (`GET ?id=` → this install's prices and the launch offer as text), `api/_prices.js` (tests: `tests/unit/prices-api.test.ts`) |
| Launch offers | `api/_promos.js` (tests: `tests/unit/promos.test.ts`) |
| Customer portal | `api/portal.js` (`POST {id}` → `{url}`), for Manage on a subscription |
| Shared Stripe code | `api/_stripe.js` (tests: `tests/unit/license-api.test.ts`) |
| Upgrade and thanks pages | `site/upgrade.html`, `site/upgrade-thanks.html`, `site/upgrade.js`, offer frame `site/offer.js` (also on `site/pricing.html`) |
| Extension | `src/shared/license.ts`, `src/sw/license.ts`, Settings row `src/ui/ads-setting.ts`, "Remove ads" in the ad |

## Settings it needs

Stripe (FollowUs AI account): the product **Vidzilla without ads**
(`prod_VWF2IPKPVl6qYF`) with these prices:

| Price | ID | Who sees it |
| --- | --- | --- |
| $0.99 USD a year (created 2026-10-27) | `price_1UVCY5DyfH6JDnExHp32eh4D` | group a, and the public pages |
| $0.99 USD a week (created 2026-10-29) | `price_1UVw1zDyfH6JDnEx6vg7rnpw` | group b |
| $7.00 USD every 3 months (created 2026-10-29) | `price_1UVw2LDyfH6JDnExXYV5n9bw` | group c |
| $9.00 USD one-time (created 2026-10-27) | `price_1UVCYWDyfH6JDnExJGS2PSsl` | everyone |

and a **restricted API key** named "Vidzilla website" with these permissions
and nothing else:

| Resource | Permission |
| --- | --- |
| Checkout Sessions | Write |
| PaymentIntents | Read |
| Charges | Read |
| Subscriptions | Read |
| Prices, Products, Customers | Read |
| Coupons, Promotion codes | Read (for launch offers, `api/_promos.js`) |
| Invoices | Read (for the first-charge check, `chargedBefore` in `api/_stripe.js`) |
| Customer portal | Write (for Manage, `api/portal.js`) |

The customer portal uses its own live configuration, **Vidzilla**
(`bpc_1UZA0DDyfH6JDnExHm1XDQLR`, made in the Dashboard on 2026-11-07), not
the account default that Guppy and Beans share. It lets customers update
their name, email, address and phone, see invoices, update payment methods,
and cancel at the end of the billing period with a reason; plan changes and
pauses are off. Headline "Manage your Vidzilla subscription", default return
address https://vidzilla.followusai.com. Privacy and terms links come from
the account's public details (followusai.com), since a configuration made in
the Dashboard can't set its own. To change it: Stripe dashboard, Settings,
Billing, Customer portal, the Vidzilla configuration. If it's ever deleted,
remove `configuration` from `portalSession` to fall back to the default.

Vercel (project `vidzilla`, Production):

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | the restricted key (`rk_live_...`), saved as a Secret |
| `STRIPE_PRICE_SUBSCRIPTIONS` | the subscription prices under test, in group order: `price_1UVCY5DyfH6JDnExHp32eh4D,price_1UVw1zDyfH6JDnEx6vg7rnpw,price_1UVw2LDyfH6JDnExXYV5n9bw` |
| `STRIPE_PRICE_YEARLY` | `price_1UVCY5DyfH6JDnExHp32eh4D`, used only when `STRIPE_PRICE_SUBSCRIPTIONS` is empty |
| `STRIPE_PRICE_LIFETIME` | `price_1UVCYWDyfH6JDnExJGS2PSsl` |
| `STRIPE_PROMO_CODES` | optional: launch offer codes, oldest first, such as `LAUNCH100,LAUNCH50` (see below) |
| `STRIPE_WEBHOOK_SECRET` | the webhook endpoint's signing secret (`whsec_...`), saved as a Secret |

Without them the API answers 503 and the upgrade page says checkout isn't set
up; ads keep working either way. Without `STRIPE_WEBHOOK_SECRET` only the
webhook answers 503 (Stripe keeps retrying), and `paid` still comes from the
thanks page.

The webhook (for `paid` and `subscription_cancelled`, see
[Analytics](#analytics)): Stripe dashboard, live mode, Developers,
Webhooks, **Add destination**, Your account, with

- Endpoint URL `https://vidzilla.followusai.com/api/stripe-webhook`
- Events `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `customer.subscription.deleted`, `invoice.paid`
- API version: any; the fields it reads are the same in all current ones.

Then copy its signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel and
redeploy. The first-charge check (`chargedBefore`) reads PaymentIntents,
Subscriptions and Invoices with the restricted key. The
buyer's answer in `cancellation_reason` comes from **Cancellation reason** in
the Vidzilla portal configuration (above): too_expensive, missing_features,
switched_service, unused and other, as of 2026-11-07.

## Prices and the A/B/C test

- **Stripe holds the prices; nothing else does.** `api/_prices.js` reads each
  price from Stripe (cached for 10 minutes) and turns it into words ("$0.99 a
  week", "$7 every 3 months", "$9 once").
- **Groups:** with more than one price in `STRIPE_PRICE_SUBSCRIPTIONS`, an
  install's group is the first 8 hex digits of its random install ID modulo
  the number of prices, so installs split evenly and one person always sees
  the same price. Group a is the first price listed, b the second, and so on.
  Checkout charges the group's price, and the session, subscription and
  payment carry `variant` metadata (a, b, c) next to `install_id`.
- **Where prices show:** the upgrade page swaps in the install's prices from
  `/api/prices?id=` before its buttons work. Vidzilla's Settings asks the
  same address when opened (at most every 6 hours) and keeps the answer.
  The public pages (pricing, upgrade, support, terms, llms.txt) are filled in
  at build time with group a's prices from the `{{price.*}}` markers; without
  a Stripe key (local builds) they use `DEFAULT_OFFER`.
- **Changing prices:** make a new price in Stripe (a price's amount can't be
  edited), put its ID in the Vercel variable, and **Redeploy** so the public
  pages pick it up. Settings and the upgrade page follow within 6 hours and
  10 minutes; no extension release. Existing subscribers keep the price they
  signed up at.
- **Dropping one price:** delete its ID from `STRIPE_PRICE_SUBSCRIPTIONS`
  and redeploy; installs split evenly across the prices left. Removing or
  reordering IDs moves installs between groups, so some people see a
  different price than before; swapping an ID in place moves nobody.
- **Ending the test:** set `STRIPE_PRICE_SUBSCRIPTIONS` to the winner alone
  and redeploy; everyone then sees that price.
- **Reading the test:** in Stripe, Payments or Subscriptions, filter or
  export by the `variant` metadata, and compare against how many installs
  each group has (about a third each). The figure to compare is revenue per
  install over the same period, since a cheaper price may sell more often.

## Launch offers

A launch offer is a promotion code that checkout applies for the buyer and
the upgrade page advertises, with how many people have claimed it.

1. In Stripe, make a coupon (Product catalog, Coupons). Its **name** is the
   offer's label on the page ("Launch offer"), and its **duration** sets
   the wording: Forever reads "for as long as you stay subscribed", Once
   reads "your first year" (or week, or 3 months, by the buyer's price), and
   a number of months reads as the billing periods it covers. Lifetime gets
   the discount once whatever the duration.
2. On the coupon, **Add promotion code**, with a code (`LAUNCH100`), and
   under its options a limit on redemptions and an expiry date if wanted.
3. In Vercel, add the code to the end of `STRIPE_PROMO_CODES` and redeploy.

The last code in the list that is still running (active, under its limit,
before its end date) is applied to every checkout; the page shows its
headline ("Your first year free."), "63 of 100 claimed · ends 30
November", and each plan's price with it. Codes before it that were used
stay listed as finished rounds ("Launch offer: 100 people got Vidzilla
ad-free for free."). When the running code runs out or expires, checkout
goes back to full price with the code box, and the page shows only the
finished rounds; no deploy needed. The counts are Stripe's
`times_redeemed`, read at most once a minute. If the key can't read
promotion codes, offers are left out and checkout works as before.

The public pricing page (`/pricing`) shows the same offer for people who
find Vidzilla through the website. It doesn't know their test group, so its
wording names no subscription price or period ("Free for as long as you
stay subscribed.", "Your first billing period free.", "Your first 3 months
free.") and only the lifetime price, which is the same for everyone. It
tells them to add Vidzilla and choose Remove ads in its Settings, where the
code is applied. `GET /api/prices` returns this wording as `publicPromo`.

## Coupons

Without a running launch offer, checkout has `allow_promotion_codes` on, so
Stripe's page shows an "Add promotion code" field. A coupon is the discount; customers type a
**promotion code** made from it (Stripe dashboard, Product catalog, Coupons,
open the coupon, **Add promotion code**). A 100% off code works on lifetime
too: the kept checkout above keeps it counted.

## Running it

- **Refunds:** refund in the Stripe dashboard. A refunded lifetime payment
  stops counting at the next daily check. The terms promise a full refund
  within 30 days on request.
- **Cancelling a subscription:** the buyer presses **Manage** in Vidzilla's
  Settings (or the link in their Stripe receipt), which opens the customer
  portal; or you cancel it in the dashboard.
- **Moved to a different Chrome profile:** their new copy has a new install
  ID. In Stripe, open their payment or subscription and set its
  `install_id` metadata to the ID from the new copy. The ID is in
  `chrome.storage.sync`; support can ask them to read it from the address of
  the upgrade page that **Remove ads** opens.
- **Fees:** Stripe's standard US price is 2.9% + 30¢ (plus 0.7% for Billing on
  subscriptions), so a $0.99 payment keeps about 65¢, $7 keeps about $6.45
  and $9 keeps about $8.44. At $0.99 about a third goes to fees on every
  charge, weekly or yearly; weekly just charges 52 times a year.

## Analytics

Five product events go to PostHog (project 708991, US cloud, "Discard
client IP data" on), all with the install ID as the person and
`product: "vidzilla"`. The extension sends only the first two (that's all
the privacy policy and the store listing promise for it); the checkout,
license and Stripe webhook functions send the other three:

- `signed_up`: a new install (`chrome.runtime.onInstalled` with reason
  `install` in `src/sw/main.ts` calls `noteInstalled` in
  `src/sw/analytics.ts`), with `method: "extension_install"`, since Vidzilla
  has no accounts. Once per install ID (`signedUpAt` in `chrome.storage.sync`,
  so a reinstall on the same Chrome profile isn't counted again). If PostHog
  can't be reached it stays pending (`signUpPending` in
  `chrome.storage.local`) and is retried when Chrome starts and before the
  first `activated`. Updates never send it.
- `activated`: the first file an install saves (`Downloads.onSaveChanged` in
  `src/sw/downloads.ts` calls `noteActivated` in `src/sw/analytics.ts`), sent
  by the service worker with `fetch`, once per install ID (`activatedAt` in
  `chrome.storage.sync`, set once PostHog took it). Copies updated from
  1.0.4 or older that had saved files already are marked without sending.
- `checkout_started`: Stripe made a Checkout Session for an install
  (`POST` in `api/checkout.js` calls `reportCheckout`, with
  `checkoutStartedEvent` in `api/_posthog.js`, after the answer goes out with
  `waitUntil`). Properties: `plan`, `variant` (the price group), `promo_code`
  when a launch code was applied (not when it had run out and the checkout fell
  back to full price), and `amount` (major units, discounts included) and
  `currency` when Stripe gives `amount_total`. `$geoip_disable: true`, no
  email. One per session (its `uuid` comes from the session ID), so pressing
  a plan's button twice counts twice.
- `paid`: a first paid purchase, subscription or lifetime, sent from two places
  as one event. The Stripe webhook (`api/stripe-webhook.js`) sends it on
  `checkout.session.completed`, or on
  `checkout.session.async_payment_succeeded` for a payment that clears later,
  so it's counted even when the buyer closes the tab. The thanks page also
  calls `/api/license` with `confirm=1` (once per browser); when the checkout
  says yes, `reportSale` in `api/license.js` sends it too. Both build it with
  `saleOf` in `api/_stripe.js`: `plan`, `amount` (major units: 9 for $9.00),
  `currency` (lowercase), `variant` and the buyer's
  email as a person property. Its `uuid` comes from the Checkout Session ID
  and its timestamp is the session's creation, so the two reports (and
  Stripe's retries) are the same event and PostHog keeps one. Not sent for
  a checkout that charged nothing (a 100% off launch code), the same as
  Beans and Guppy, so free claims show up only as `checkout_started` with
  `amount: 0`. Not sent when the install was charged before
  (`chargedBefore`: a paid lifetime payment carrying its install ID, or a
  paid invoice above 0 on one of its subscriptions); an earlier free plan
  doesn't count. The thanks page also skips a checkout over a day old.
  A subscription that started free and later charges (a code that covers
  only the first months) sends `paid` from `invoice.paid` instead
  (`invoiceSale`): the first invoice above 0 that isn't a subscription's
  first (`billing_reason` other than `subscription_create`, which its
  checkout reports), when the install was never charged before. Its `uuid`
  comes from the invoice ID and its timestamp is when it was paid; `amount`
  is what was charged and the email is the invoice's.
- `subscription_cancelled`: a subscription that ended
  (`customer.subscription.deleted` in `api/stripe-webhook.js`,
  `endedSubscription` in `api/_stripe.js`, `subscriptionCancelledEvent` in
  `api/_posthog.js`), with the same properties as Beans and Guppy:
  `plan: "subscription"`, `variant`, `cancellation_reason` (the reason picked
  in the customer portal, else Stripe's), `stripe_cancellation_reason`
  (`cancellation_requested`, `payment_failed`, `payment_disputed`),
  `days_subscribed` (start to end, trial included) and `ended_in_trial`. The
  portal's free-text comment is never sent. Once per subscription: its `uuid`
  comes from the subscription ID and its timestamp is when it ended. A
  subscription whose first payment never went through
  (`incomplete_expired`) isn't one.

The Stripe account is shared with Guppy and Beans, so the webhook only acts
on checkouts and subscriptions carrying a Vidzilla install ID
(`client_reference_id` and `metadata.install_id`, from `checkoutParams`;
anything tagged with another `metadata.app` is skipped; an invoice is
judged by its subscription's metadata) and acknowledges the
rest with 200. Test-mode events are ignored. It checks the
`Stripe-Signature` header itself (HMAC-SHA256, five-minute tolerance, no
Stripe SDK) and answers 500 when Stripe or PostHog fails, so Stripe retries
for up to three days; nothing is stored. Its log line is
`stripe webhook <type> <event id> failed`.

The website sends two more, anonymously, from the server, so the site keeps
no PostHog script and sets no cookies (`api/_web-analytics.js`):

- `$pageview`: `middleware.js` (`reportPageView`) for each GET of a listed
  page (`site/pages.mjs`) or `/upgrade-thanks` on vidzilla.followusai.com,
  handed to `waitUntil` so the page never waits. Skipped: bots, crawlers,
  link previews, scripts and headless browsers (by user agent, or none),
  prefetches and prerenders (`Purpose`, `Sec-Purpose`, `X-Purpose`, `X-Moz`,
  `Next-Router-Prefetch`, `RSC`), markdown requests, HEAD, any path with a
  file extension (assets, `ads.json`, `.md`, `/x.html`), `/api/`, `/go/` and
  unknown paths, and any other host (local builds, `*.vercel.app` previews).
- `store_link_clicked`: every "Add to Chrome" link is
  `/go/chrome-web-store?from=<button>` (`home-hero`, `home-steps`,
  `pricing-offer`, `pricing-install`, `md-*` in the markdown twins).
  `vercel.json` rewrites it to `api/store-link.js`, which always answers 302
  to `release.storeUrl` (`site/release.js`) plus
  `utm_source=vidzilla.followusai.com&utm_medium=website`, and reports the
  click with `waitUntil`; a PostHog error or hang never touches the
  redirect. Properties: `from`, the referring page as `$current_url` /
  `$pathname`, and `utm_*` from the link or else the referring page. Bots,
  prefetches, HEAD and other hosts are redirected without a report.

Both use a daily hash as `distinct_id`: SHA-256 of a fixed, non-secret salt,
the UTC date, the visitor's IP (`x-real-ip`) and user agent, so a visitor is
the same all day and new the next. The IP is never sent. They also send
`$process_person_profile: false` (no person profiles), `$geoip_disable: true`
(the request comes from Vercel), `$raw_user_agent` (PostHog derives browser,
OS and device), `$referrer` / `$referring_domain` (query dropped, `$direct`
without one), `$host` and `$lib` (`server-pageview` or `server-redirect`).
`$current_url` keeps only `utm_*` from the query, since the upgrade pages
carry the install ID and checkout ID there. Vercel Web Analytics stays on
alongside. Check a deploy with one request as a clear user agent, e.g.
`curl -A 'posthog-verify/1.0 (claude-code)' https://vidzilla.followusai.com/`,
then filter on `$raw_user_agent` in PostHog.

## Store and policy

- Chrome Web Store: mark that the item has in-app purchases.
- The privacy policy, terms (refunds, what "once" means), pricing, support
  and upgrade pages describe all of this, including that the server exists
  only to check whether a copy paid.
