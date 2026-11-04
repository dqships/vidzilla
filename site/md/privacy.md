# Privacy policy

Effective 4 November 2026

Vidzilla is a Chrome extension that finds the video and audio a page plays and saves it to your computer. It has no accounts. It doesn't sell your personal information, and it contains no third-party ad code. When it's installed, and the first time it saves a file, it reports each of those once to PostHog, our product analytics service, and if you buy the ad-free upgrade our server reports the purchase there too (see Product analytics below). Every few downloads it shows a short ad for another app by the same maker.

## What Vidzilla reads

To find media, Vidzilla looks at the network requests Chrome makes in your tabs: their addresses and content types. For requests that turn out to be video or audio, it also notes the cookie, referrer and origin headers the page sent, so that saving the file works the same way playing it did. It reads the page's title to name the file.

On a page whose video can't be fetched as a file, Vidzilla offers to record the player instead. Only when you press Record does it copy the video and audio the player loads, and only on that tab, until the recording ends or you stop it.

## Where that information stays

On your computer. The list of media found in each tab is kept in Chrome's session storage for the extension and is cleared when the tab closes or Chrome quits. Your settings, such as the filename pattern, are kept in Chrome's local storage for the extension, and so is the history of files you saved: each file's name, page address, title, thumbnail, size and date. You can clear the history from the settings page at any time. A count of how many files you've saved and when you last saw an ad is kept there too, to space the ads out. Files you save go to your Downloads folder, fetched directly from the site that served them.

## What Vidzilla sends

Nothing about the pages you visit or what you save. Most of Vidzilla's requests go to the sites that host the media you choose to save, the same requests the page itself made. Two small ones go to our website, vidzilla.followusai.com, and two, each sent only once, to PostHog:

- **The list of ads**: every few hours it downloads ads.json, the text and links of the current ads. Seeing or clicking an ad isn't reported anywhere.
- **The ad-free check**: when you buy, when you press Check again, and once a day after you've paid, it sends your copy's install ID, a random code made when Vidzilla was installed and synced with your Chrome profile, and gets back whether that ID paid to remove ads. On a subscription, Manage in Settings sends the same ID to open Stripe's billing page, where you can cancel or change your card. Opening Settings also asks, at most every few hours, what removing the ads costs this copy, sending the same ID. It asks Stripe and answers yes or no, and keeps no records of its own.
- **The install**: when Vidzilla is first installed, it sends PostHog one event, "signed_up", with the install ID, Vidzilla's version and the time. Vidzilla has no accounts, so this only counts new installs. It's sent once per install ID: reinstalling on the same Chrome profile doesn't send it again.
- **The first save**: the first time your copy saves a file, it sends PostHog one event, "activated", with the install ID, Vidzilla's version and the time. It's sent once per install ID and never again, and it says nothing about the page or the file.

These requests carry no cookies and nothing about you or your downloads. Like any web request they reach our host, Vercel, from your IP address, which we don't use to identify you.

## If you pay to remove ads

Payment happens on Stripe's checkout page. Stripe receives your card details and email address to take the payment and send your receipt, under [Stripe's privacy policy](https://stripe.com/privacy); we never see your card number. Stripe keeps the purchase with your install ID attached, which is how Vidzilla knows to stop the ads. We see the purchase in our Stripe account (email, plan, amount, date) and use it only for receipts, refunds and support. When the thanks page confirms your first purchase, our server also reports it to PostHog as one "paid" event: the install ID, the plan, the amount and currency, and the email address you gave Stripe.

## Product analytics

We use [PostHog](https://posthog.com/privacy) to count how many copies get installed, how many get Vidzilla working and how many go on to pay, so we can improve it and contact buyers about their purchase. PostHog stores this for us as our processor, on its US servers (PostHog Cloud US), and doesn't use it for its own purposes. It receives only the three events above: "signed_up" and "activated" from the extension, and "paid" from our server, all filed under your copy's install ID, with your email added only if you buy. Nothing else is reported: not the pages you visit, the media Vidzilla finds or saves, or how you use it. Like any web request, the extension's two requests reach PostHog from your IP address; PostHog discards the address instead of storing it, and we don't have it look up your location. To have this data deleted, write to [{{supportEmail}}](mailto:{{supportEmail}}) with your install ID or purchase email.

## Our website

The website, vidzilla.followusai.com, uses Vercel Web Analytics to count visits. It sets no cookies. For each page view it records the page address, the referring site, your country, and your browser, operating system and device type. It tells visits apart with a daily hash of your IP address and browser that isn't stored and can't be used to identify you. Vercel, our host, processes this for us. It covers the website only: the extension sends nothing to it.

## Why it asks for its permissions

- **Read and change data on all websites**: Video can come from any site, so Vidzilla watches requests in every tab and replays a page's headers when you save.
- **Manage your downloads**: To save the finished file to your Downloads folder.
- **Tabs and navigation**: To keep each tab's list of media separate and clear it when you leave the page.
- **Storage**: To keep the media list, your settings, your download history and in-progress downloads on your device, and the install ID in Chrome's synced storage.

## Protected video

Vidzilla does not save video protected by DRM and does not try to get around it.

## Changes and contact

If this policy changes, the new version will be posted here with a new effective date. Questions about privacy go to [{{supportEmail}}](mailto:{{supportEmail}}) or the [contact page]({{origin}}/contact).
