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

interface BeaconEvent {
  eventType: 'page_view' | 'cart_add';
  path?: string;
  listingId?: string;
}

function send(events: BeaconEvent[]): void {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.sendBeacon !== 'function'
  )
    return;
  try {
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
