// First-party activity beacon. Fires navigator.sendBeacon for events that
// have no server touch — page navigation (ambient) and cart adds. Anonymous
// by transport (sendBeacon can't attach the Clerk auth header), stitched by a
// stable first-party device id. The MEANINGFUL signed-in actions (listing
// view, search, offer, bid, checkout, login) are captured server-side with
// the user's id, so this beacon deliberately does NOT re-send those (no
// double-counting).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const DEVICE_KEY = 'gg_did';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `d_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Which install path the browser actually offers. Mirrors the allowlist in
 *  the backend's ActivityController — a value outside it is dropped there. */
export type InstallPlatform =
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'desktop'
  | 'unknown';

/** Which of our surfaces fired the event. Also mirrored + allowlisted. */
export type InstallSurface = 'popup' | 'bar' | 'help' | 'nav' | 'footer';

interface BeaconEvent {
  eventType:
    | 'page_view'
    | 'cart_add'
    | 'install_shown'
    | 'install_clicked'
    | 'install_dismissed'
    | 'install_completed';
  path?: string;
  listingId?: string;
  platform?: InstallPlatform;
  surface?: InstallSurface;
}

function send(events: BeaconEvent[]): void {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.sendBeacon !== 'function'
  )
    return;
  try {
    // Operator exclusion: sendBeacon can't carry auth, so the server-side
    // admin filter can never match beacon events. If this browser holds an
    // admin token, it's the operator — don't track at all.
    if (window.localStorage.getItem('gg_admin_token')) return;
    const body = JSON.stringify({ deviceId: getDeviceId(), events });
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(`${API_URL}/activity`, blob);
  } catch {
    /* best-effort — never surface to the user */
  }
}

export function trackPageView(path: string): void {
  send([{ eventType: 'page_view', path }]);
}

export function trackCartAdd(listingId: string): void {
  send([{ eventType: 'cart_add', listingId }]);
}

/**
 * Install funnel. Exempt from the "don't re-send what the server already
 * captures" rule at the top of this file, because the server captures NOTHING
 * here: showing an install popup touches no endpoint, and on iOS the install
 * itself never touches one either (Safari's Add to Home Screen is entirely
 * outside our code). Without this beacon the only evidence that any of it
 * happened is somebody telling us.
 *
 * `install_completed` is best-effort by nature — it rides the `appinstalled`
 * event, which iOS does not fire. iOS installs are therefore INVISIBLE to us;
 * read shown/clicked as the iOS funnel and do not treat a missing completion
 * as a failed install.
 */
export function trackInstall(
  step: 'shown' | 'clicked' | 'dismissed' | 'completed',
  platform: InstallPlatform,
  surface: InstallSurface,
): void {
  send([{ eventType: `install_${step}` as BeaconEvent['eventType'], platform, surface }]);
}
