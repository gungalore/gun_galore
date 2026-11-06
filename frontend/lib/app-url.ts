/**
 * WHICH LINKS BELONG TO THIS APP — one rule, three callers, two processes.
 *
 * Notification rows store an absolute URL because email and SMS need one. That
 * URL is baked at send time, so it outlives whatever hostname produced it: a
 * trycloudflare tunnel, a localhost dev server, a preview deploy. Anywhere the
 * member is reading the row — the in-app inbox, or an OS notification tapped on
 * a phone — the correct target is the path, resolved against the host they are
 * already on.
 *
 * ⚠️ THIS LIVES OUTSIDE lib/notifications.ts BECAUSE THE SERVICE WORKER CANNOT
 * IMPORT THAT FILE. The worker is a separate bundle with no `window`, and
 * notifications.ts reads `window.location.origin` and holds fetch helpers for
 * the inbox. The part that has to agree — which hostnames are ours, and how to
 * reduce one of their URLs to a path — is pure, so it lives here and both sides
 * import it. app/sw.ts and lib/notifications.ts disagreeing about this is how a
 * tapped push opens a browser tab instead of the installed app.
 *
 * ⚠️ KEEP THIS MODULE FREE OF `window`, `document` AND `next/*`. It is compiled
 * into the service worker.
 */

/**
 * Hosts that are this product, whatever they look like.
 *
 * The tunnel entries are not sloppiness: a push payload written while the
 * operator was testing on a tunnel carries that hostname forever, and the row
 * is not rewritten when the tunnel dies. Treating it as an app host means the
 * tap lands on the right PATH instead of on a dead domain.
 */
const APP_HOSTS = ['alloutdoor.co.za', 'gungalore.co.za'] as const;

/** Hosts that only exist while developing. Same reasoning, different list. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;

/** Throwaway tunnels used for device testing (cloudflared). */
const TUNNEL_SUFFIX = '.trycloudflare.com';

/** Is this hostname one of ours? Exact match or a subdomain of one. */
export function isAppHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if ((LOCAL_HOSTS as readonly string[]).includes(host)) return true;
  if (host.endsWith(TUNNEL_SUFFIX)) return true;
  return APP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Reduce a URL that points at this app to its path. Anything else — a
 * third-party link, a non-http scheme, a relative path already — is returned
 * untouched.
 *
 * `origin` is the caller's own origin. In a window that is `window.location
 * .origin`; in the service worker it is `self.location.origin`. Passing it in
 * rather than reading it means the same function answers correctly on both
 * sides, and means it is testable without a DOM.
 */
export function stripToAppPath(url: string, origin?: string): string {
  if (!url || url.startsWith('/') || url.startsWith('#')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    const sameOrigin = Boolean(origin) && parsed.origin === origin;
    if (!sameOrigin && !isAppHost(parsed.hostname)) return url;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Not a URL we can parse. Leave it to the caller rather than guessing.
    return url;
  }
}
