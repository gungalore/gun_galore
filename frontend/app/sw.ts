// Service worker source — compiled by @serwist/next during `next build`
// into /sw.js at the project root and registered automatically by the
// Serwist runtime.
//
// Caching strategy (Phase C → E):
//   • Static JS/CSS bundles (/_next/static/*) — fingerprinted by Next,
//     so cache-first is always safe. Covered by Serwist's defaultCache.
//   • Google Fonts — covered by Serwist's defaultCache.
//   • Cloudinary images (res.cloudinary.com) — stale-while-revalidate,
//     30-day max. Massive repeat-load speedup; safe because image URLs
//     are immutable per upload (they get a new public_id on re-upload).
//   • Next-optimized images (/_next/image) — stale-while-revalidate,
//     30-day max. Same reasoning — URLs are fingerprinted.
//   • Brand static assets in /public (logo, manifest, icons) —
//     stale-while-revalidate. Updates land within a tab refresh.
//   • HTML pages, /api/*, anything containing 'clerk' — deliberately
//     NOT cached. Network-only. Prices, auctions, bids, and auth must
//     never go stale.
//   • Offline fallback page at /offline for navigations that fail.
//
// Kill switch: setting NEXT_PUBLIC_DISABLE_PWA=true at build time
// disables SW generation entirely. Useful if a caching bug ships.

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import {
  Serwist,
  ExpirationPlugin,
  StaleWhileRevalidate,
  NetworkOnly,
} from 'serwist';

// Tell TypeScript this is the service worker's global scope.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected at build time by @serwist/next with the list of
    // precached assets the SW should keep available offline.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// CRITICAL: bypass the service worker entirely for admin routes,
// backend API, Clerk, and the payment gateway hosted pages. These must
// always hit the network fresh — admin data is real-time, API responses
// contain auth state, Clerk does its own dance with cookies, and the
// gateway hosted pages must never be served from cache. Putting these
// BEFORE every other rule (including defaultCache and the navigation
// fallback) ensures nothing else can intercept them.
const networkOnlyRoutes: RuntimeCaching[] = [
  {
    matcher: ({ url }) => url.pathname.startsWith('/admin'),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url }) => url.pathname.startsWith('/api/'),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url }) =>
      url.hostname.includes('clerk') ||
      url.pathname.startsWith('/sign-in') ||
      url.pathname.startsWith('/sign-up') ||
      url.pathname.startsWith('/sso-callback'),
    handler: new NetworkOnly(),
  },
  {
    // Token-gated SMS action pages — single-use auth, must be fresh.
    matcher: ({ url }) =>
      url.pathname.startsWith('/a/') ||
      url.pathname.startsWith('/preview') ||
      url.pathname.startsWith('/checkout'),
    handler: new NetworkOnly(),
  },
];

// Custom image + asset caches layered ON TOP of Serwist's defaultCache.
// Each entry uses its own named cache so we can expire/inspect them
// independently in DevTools → Application → Cache Storage.
const imageCaching: RuntimeCaching[] = [
  {
    // Cloudinary — every listing photo, KYC doc preview, hero
    // imagery, etc. Single biggest bandwidth saver in the SW.
    matcher: ({ url }) => url.hostname === 'res.cloudinary.com',
    handler: new StaleWhileRevalidate({
      cacheName: 'gg-cloudinary-images',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  {
    // Next.js Image optimizer — covers any <Image src=...> that
    // points at a local /public asset OR a remote URL that Next
    // optimized server-side.
    matcher: ({ url }) => url.pathname.startsWith('/_next/image'),
    handler: new StaleWhileRevalidate({
      cacheName: 'gg-next-images',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 30,
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  {
    // Brand static assets — logo.svg, logo-mark.svg, PWA icons,
    // background photos in /public. Stale-while-revalidate so a
    // logo update lands within a tab refresh, not a full re-deploy.
    matcher: ({ request, url }) =>
      url.origin === self.location.origin &&
      (request.destination === 'image' || /\.(svg|ico)$/.test(url.pathname)) &&
      !url.pathname.startsWith('/_next/'),
    handler: new StaleWhileRevalidate({
      cacheName: 'gg-brand-assets',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 30,
          maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days — brand assets change rarely
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Controlled "prompt-to-update" — deliberately NOT auto-activating.
  // With skipWaiting/clientsClaim TRUE, a freshly deployed SW seizes an
  // already-open PWA mid-session; the old page then lazy-loads a chunk
  // the new build replaced → 404 → dead shell (exactly what a redeploy
  // did to installed apps). Instead the new SW WAITS: the old SW keeps
  // serving the open session from its intact caches (no mid-session
  // break), the update banner detects the waiting worker, and only when
  // the user taps Reload do we post SKIP_WAITING (handler below) to
  // activate it on their terms.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  // Order matters — Serwist evaluates routes top-down, first match
  // wins. Network-only rules MUST come first so admin/api/auth always
  // bypass caching entirely. Image rules come next so Cloudinary
  // doesn't get intercepted by defaultCache's generic image matcher.
  runtimeCaching: [...networkOnlyRoutes, ...imageCaching, ...defaultCache],
  // Navigation fallback — when offline and the page isn't cached,
  // serve /offline instead of the browser's default network error.
  // Carved out: admin pages never fall back (they must error visibly
  // so the operator knows the backend is down, not show a stale page).
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => {
          if (request.destination !== 'document') return false;
          // Fallback matcher only gets `request`, not `url` — derive
          // pathname from request.url to apply the same carve-outs as
          // the network-only routes above.
          const path = new URL(request.url).pathname;
          return (
            !path.startsWith('/admin') &&
            !path.startsWith('/a/') &&
            !path.startsWith('/checkout') &&
            !path.startsWith('/preview') &&
            // Ask GG is inherently online-only (Claude API + Clerk +
            // live quota state). Falling through to /offline misleads
            // users into waiting instead of reconnecting. Error
            // visibly so the browser's "you're offline" UI shows.
            !path.startsWith('/ask-gg') &&
            // M23 — KYC verify needs the camera + VerifyNow + the
            // KYC API endpoints. Same rationale as Ask GG: serving
            // /offline here misleads sellers who DO have signal but
            // hit a brief blip mid-capture. Sign-in / sign-up rely
            // on Clerk being reachable for the same reason.
            !path.startsWith('/kyc') &&
            !path.startsWith('/sign-in') &&
            !path.startsWith('/sign-up')
          );
        },
      },
    ],
  },
});

serwist.addEventListeners();

// Controlled-update handshake. The update banner posts this message to
// the WAITING service worker when the user taps "Reload"; we then
// activate (skipWaiting was false, so the worker was parked). Activation
// fires `controllerchange` in the page, which the banner uses to reload
// into the new bundle. Any other message is ignored.
//
// NOTE: Serwist v9 also registers its own SKIP_WAITING message handler
// internally, so this listener is technically redundant on the current
// version. It's kept as an explicit, self-documenting backstop that
// stays correct if that internal behaviour changes across upgrades —
// both call self.skipWaiting(), which is idempotent, so there is no
// conflict or double-activation.
self.addEventListener('message', (event) => {
  const data = (event as ExtendableMessageEvent).data as
    | { type?: string }
    | undefined;
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Web Push handlers ──────────────────────────────────────────────
//
// Fires when the backend pushes a notification to one of this user's
// subscriptions. The push payload is JSON (set on the backend via
// PushService.sendToUser). We show an OS-level notification; tapping
// it opens (or focuses) the URL specified in the payload.
//
// PWA caveats:
//   - iOS Safari 16.4+ supports web push, but ONLY when the PWA is
//     installed to the home screen. The opt-in UI gates on this.
//   - Android Chrome works everywhere.
//   - Firefox + Edge use Mozilla's autopush + Microsoft's WNS
//     respectively; both go through the same web-push library on the
//     backend.
//
// `tag` dedupes — passing the same tag for a re-fired notification
// (e.g. successive outbids on the same auction) replaces the
// previous OS notification instead of stacking. Keeps the lock
// screen clean.
self.addEventListener('push', (event) => {
  const e = event as PushEvent;
  if (!e.data) return;
  let payload: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  } = {};
  try {
    payload = e.data.json();
  } catch {
    // Plain-text fallback — backend always sends JSON but defend
    // against partner-injected pushes anyway.
    payload = { title: 'Gun Galore', body: e.data.text() };
  }
  const title = payload.title ?? 'Gun Galore';
  const body = payload.body ?? '';
  const url = payload.url ?? '/';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      data: { url },
      requireInteraction: false,
    }),
  );
});

// Tapping the notification opens (or focuses) the deep-link URL.
// If the PWA is already running in a tab/window we focus it; else
// we open a new one.
self.addEventListener('notificationclick', (event) => {
  const e = event as NotificationEvent;
  e.notification.close();
  const url = (e.notification.data as { url?: string } | undefined)?.url ?? '/';
  e.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an existing tab on the same origin — saves a
      // hard reload and preserves session state.
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await (client as WindowClient).navigate(url);
            await (client as WindowClient).focus();
            return;
          } catch {
            /* fall through to openWindow */
          }
        }
      }
      // Nothing to focus → open fresh.
      await self.clients.openWindow(url);
    })(),
  );
});
