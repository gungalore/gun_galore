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
//   • HTML pages, /api/*, every auth route — deliberately
//     NOT cached. Network-only. Prices, auctions, bids, and auth must
//     never go stale.
//   • Offline fallback pages for navigations that fail — /offline for the
//     shop. The Desk's /admin/offline stand-in went with the Desk on
//     2026-09-22. Which page answers a given failure is decided in
//     lib/sw-offline.ts, because nothing under app/ is collected by vitest
//     and a rule written here could never be tested.
//
// Kill switch: setting NEXT_PUBLIC_DISABLE_PWA=true at build time
// disables SW generation entirely. Useful if a caching bug ships.

import { defaultCache } from '@serwist/next/worker';
import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
} from 'serwist';
import {
  Serwist,
  ExpirationPlugin,
  StaleWhileRevalidate,
  NetworkOnly,
} from 'serwist';
// ⚠️ THE FALLBACK RULES LIVE IN lib/, NOT HERE, AND THAT IS THE ONLY REASON
// THEY ARE TESTED. vitest's include is ['lib/**/*.spec.ts',
// 'components/**/*.spec.tsx'] — nothing under app/ is collected, so a rule
// written inline in this file can never go red. See lib/sw-offline.spec.ts;
// this file is the adapter that hands serwist what that module decides.
import { SHOP_OFFLINE_URL, shopOfflineFallbackApplies } from '../lib/sw-offline';

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
// backend API, the auth routes, and the payment gateway hosted pages. These
// must always hit the network fresh — admin data is real-time, API responses
// contain auth state, sign-in sets httpOnly cookies, and the
// gateway hosted pages must never be served from cache. Putting these
// BEFORE every other rule (including defaultCache and the navigation
// fallback) ensures nothing else can intercept them.
const networkOnlyRoutes: RuntimeCaching[] = [
  {
    // RSC navigation + prefetch payloads are build-specific — they encode
    // the current build's chunk graph. Caching them across a redeploy
    // POISONS client-side navigation: the browser loads the new build's
    // HTML (HTML is network-only, always fresh) but is still controlled by
    // the previous SW, which serves the OLD build's RSC from its
    // `pages-rsc` cache. The build IDs mismatch, so every in-app link
    // either dead-ends (nav silently does nothing) or falls through to a
    // hard nav → /offline. Same "page content must always be fresh" rule
    // the HTML pages already follow (see file header). Force network-only
    // and keep FIRST so it wins over defaultCache's pages-rsc /
    // pages-rsc-prefetch NetworkFirst caches. Detected via the RSC /
    // Next-Router-Prefetch request headers, with a `?_rsc=` search-param
    // fallback for engines that strip custom headers off the SW request.
    matcher: ({ request, url }) =>
      request.headers.get('RSC') === '1' ||
      request.headers.has('Next-Router-Prefetch') ||
      url.search.includes('_rsc='),
    handler: new NetworkOnly(),
  },
  {
    // ⚠️ KEPT FOR THE DESK THAT WILL RETURN. The operator is rebuilding the
    // admin surface, so there is no /admin route today and this matcher is
    // dormant; it stays because a cached control panel is a number the
    // operator acts on that stopped being true, and the rebuild should not
    // have to remember to re-add it.
    matcher: ({ url }) => url.pathname.startsWith('/admin'),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url }) => url.pathname.startsWith('/api/'),
    handler: new NetworkOnly(),
  },
  {
    // ⚠️ EVERY AUTH ROUTE, AND THE LIST IS DUPLICATED ELSEWHERE. A cached
    // sign-in page is a page that posts to a session that has moved on, and a
    // cached verify page shows a code entry for an account already created.
    // SHOP_FALLBACK_EXCLUDES in lib/sw-offline.ts names the same paths for a
    // different reason — add a new auth route to BOTH.
    //
    // ⚠️ AND THE TWO LISTS ARE ALREADY ONE ENTRY OUT OF STEP: `/kyc` is
    // excluded from the shop's fallback and is NOT network-only here. Left
    // alone deliberately — whether the hosted identity hand-off should also
    // bypass the cache is the KYC track's call, not this one's. Recorded so
    // the next reader knows it is a known difference rather than an oversight.
    //
    // The hostname test that used to sit here was for the identity provider's
    // own domain. There is no third-party auth host any more; every one of
    // these is ours.
    matcher: ({ url }) =>
      url.pathname.startsWith('/sign-in') ||
      url.pathname.startsWith('/sign-up') ||
      url.pathname.startsWith('/verify-email') ||
      url.pathname.startsWith('/forgot-password') ||
      url.pathname.startsWith('/reset-password'),
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
  // 🚨 THE INJECTION POINT IS READ EXACTLY ONCE, AND IT HAS TO BE.
  // `__SW_MANIFEST` on `self` is not a variable — it is a marker the serwist
  // webpack plugin rewrites, and it counts occurrences in the SOURCE. Naming
  // it twice fails the build outright: "Multiple instances ... were found in
  // your SW source. Include it only once."
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
  // Navigation fallback — when a document request fails and the page isn't
  // cached, serve a stand-in instead of the browser's default network error.
  //
  // ⚠️ THE SHOP'S STAND-IN IS THE ONLY ONE LEFT. The Desk's /admin/offline
  // document, its precache entry and its install-time rescue were removed on
  // 2026-09-22 with the Desk. Admin navigations therefore fall through to the
  // browser's own error page, which is exactly where they were before the
  // Desk's stand-in existed — and the /admin NetworkOnly rule above is
  // untouched, so `/api/*` stays network-only permanently.
  //
  // ⚠️ A FALLBACK PLUGIN IS ATTACHED TO EVERY RUNTIME STRATEGY, NOT JUST THE
  // NAVIGATION ONE — serwist pushes it onto each handler in `runtimeCaching`,
  // NetworkOnly included. That is why the matcher below tests
  // `destination === 'document'` first: without it a failed image or fetch
  // would be answered with a page of HTML.
  fallbacks: {
    entries: [
      {
        url: SHOP_OFFLINE_URL,
        matcher: ({ request }) =>
          shopOfflineFallbackApplies(request.destination, new URL(request.url).pathname),
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
    payload = { title: 'All Outdoor', body: e.data.text() };
  }
  const title = payload.title ?? 'All Outdoor';
  const body = payload.body ?? '';
  const url = payload.url ?? '/';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      // Monochrome white-on-transparent glyph — Android renders the badge
      // as a single-colour alpha mask; a full-colour icon degrades to a
      // grey blob in the status bar.
      badge: '/badge-72.png',
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
