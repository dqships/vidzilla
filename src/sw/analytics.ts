// Product analytics, extension side: one event, `activated`, sent once per
// install the first time Vidzilla saves a file (a download or a recording
// that Chrome reports complete, see Downloads.onSaveChanged). The website's
// server sends the only other event, `paid` (api/_posthog.js).
//
// Manifest V3 allows no remotely hosted code, so no PostHog script is loaded:
// the service worker posts the event to PostHog's capture API with fetch. It
// carries the random install ID (the same one the ad-free check sends, and
// the ID purchases are filed under) and the extension's version. Never a
// page address, title, file name or anything else about what was saved.

import { getInstallId } from "../shared/license";
import { storageKeys } from "../shared/messages";

/** PostHog's capture API, US cloud. Already covered by the `<all_urls>` host permission. */
export const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/i/v0/e/";
/** Project API key (Vidzilla's PostHog project, 708991). Publishable: it can only send events. */
export const POSTHOG_KEY = "phc_r4QYEpdtzPfXKeND8mhAEM7stJtxtq8DmUuo9k38iQVx";
/** The first version that sends `activated`; installs updated from an older one may have saved already. */
export const ANALYTICS_SINCE = "1.0.5";

export interface CaptureBody {
  api_key: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export function activatedEvent(installId: string, version: string, now: number): CaptureBody {
  const at = new Date(now).toISOString();
  return {
    api_key: POSTHOG_KEY,
    event: "activated",
    distinct_id: installId,
    timestamp: at,
    properties: {
      product: "vidzilla",
      extension_version: version,
      // No location is looked up from the IP address.
      $geoip_disable: true,
      $set_once: { activated_at: at },
    },
  };
}

/** True when version a comes before b ("1.0.4" < "1.0.5"). */
export function olderVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0;
  }
  return false;
}

export interface ActivationDeps {
  /** When `activated` went out for this install, or was skipped (synced with the Chrome profile). */
  activatedAt(): Promise<number | undefined>;
  markActivated(at: number): Promise<void>;
  installId(): Promise<string>;
  /** Posts one event; true when PostHog took it. */
  send(body: CaptureBody): Promise<boolean>;
  version: string;
  now(): number;
}

async function loadActivatedAt(): Promise<number | undefined> {
  const stored = (await chrome.storage.sync.get(storageKeys.activatedAt))[storageKeys.activatedAt];
  return typeof stored === "number" ? stored : undefined;
}

async function post(body: CaptureBody): Promise<boolean> {
  try {
    const res = await fetch(POSTHOG_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const chromeDeps = (): ActivationDeps => ({
  activatedAt: loadActivatedAt,
  markActivated: (at) => chrome.storage.sync.set({ [storageKeys.activatedAt]: at }),
  installId: getInstallId,
  send: post,
  version: chrome.runtime.getManifest().version,
  now: Date.now,
});

/**
 * Sends `activated` unless this install already has. It's marked in synced
 * storage only once PostHog took it, so a save made offline tries again on
 * the next one, and another computer on the same Chrome profile (same
 * install ID) never sends it a second time.
 */
export async function activateOnce(deps: ActivationDeps): Promise<boolean> {
  if ((await deps.activatedAt()) !== undefined) return false;
  const now = deps.now();
  const sent = await deps.send(activatedEvent(await deps.installId(), deps.version, now));
  if (sent) await deps.markActivated(now);
  return sent;
}

let pending: Promise<unknown> = Promise.resolve();

/** A file was saved. Chained, so two saves finishing together send `activated` once. */
export function noteActivated(deps: ActivationDeps = chromeDeps()): Promise<boolean> {
  const next = pending.then(() => activateOnce(deps));
  pending = next.catch(() => {});
  return next;
}

/**
 * The extension was updated. A copy from before analytics that has saved
 * files already was activated long ago, so its next save isn't reported as
 * its first: it's marked without sending anything.
 */
export async function skipActivationIfSavedBefore(previousVersion: string | undefined, savedBefore: number, deps: Pick<ActivationDeps, "activatedAt" | "markActivated" | "now"> = chromeDeps()): Promise<boolean> {
  if (!previousVersion || !olderVersion(previousVersion, ANALYTICS_SINCE) || savedBefore < 1) return false;
  if ((await deps.activatedAt()) !== undefined) return false;
  await deps.markActivated(deps.now());
  return true;
}
