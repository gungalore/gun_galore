/**
 * VAPID public key → the BufferSource PushManager.subscribe() actually wants.
 *
 * The backend hands the key out as a URL-safe Base64 string (it is the same
 * string that appears in a `VAPID_PUBLIC_KEY` env var, and web-push generates
 * it that way). `applicationServerKey` takes raw bytes, so every caller has to
 * do this conversion, and doing it twice, differently, is how one of them ends
 * up subtly wrong.
 *
 * ⚠️ TWO CALLERS, TWO PROCESSES: lib/use-push.ts (the opt-in button, in a
 * window) and app/sw.ts (re-subscribing after the browser rotates a
 * subscription, in the worker). Neither may import the other — the worker has
 * no window, and use-push.ts is a React hook. This module is the shared floor
 * between them.
 *
 * Sourced from the W3C push spec's own example. The explicit ArrayBuffer is
 * load-bearing: a Uint8Array over a SharedArrayBuffer does not satisfy the DOM
 * lib's BufferSource constraint, and the cast that used to paper over it would
 * fail on a page with cross-origin isolation.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
