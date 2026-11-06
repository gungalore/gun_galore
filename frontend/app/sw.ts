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
// ⚠️ lib/app-url.ts IS COMPILED INTO THE WORKER TOO. It must stay free of
// `window` / `document` — see its header. The alternative was a second copy of
// "which hostnames are ours" here, and the two would drift the first time a
// domain changed, with the symptom being a tapped push that opens the wrong
// place. This is the same rule the inbox uses.
import { stripToAppPath } from '../lib/app-url';
import { urlBase64ToUint8Array } from '../lib/vapid-key';

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
    // ⚠️ VIDEO MUST NEVER BE CACHED BY THE SW. Safari/WebKit plays a clip with
    // Range requests, and a service-worker cache cannot reliably answer those
    // — a cached 200/partial response makes the poster show but the controls
    // never play (observed in the installed iOS PWA). Cloudinary already
    // serves range/CORS; let it answer directly.
    matcher: ({ request, url }) =>
      request.destination === 'video' ||
      /\.(mp4|webm|m3u8)$/i.test(url.pathname),
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
    // IMAGE DESTINATION ONLY: this matcher used to take every request to the
    // Cloudinary host, videos included, and swallow playback into the image
    // cache. The video NetworkOnly rule above now wins, but keep the test
    // explicit so a future reorder cannot re-break it.
    matcher: ({ request, url }) =>
      url.hostname === 'res.cloudinary.com' && request.destination === 'image',
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
    // Brand static assets — brand logos, favicons, PWA icons,
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
  //
  // ⚠️ AND THE OFFLINE DOCUMENT HAS TO BE ADDED HERE BY HAND. `fallbacks` below
  // names /offline, but in injectManifest mode that only tells the runtime
  // WHICH URL to answer a failed navigation with — it does not put the document
  // in the precache. Verified against the built worker on 2026-11-06: /offline
  // appeared twice, as its own JS chunk and as the fallbacks entry, and never
  // as a precache entry. So the first time a member opened the installed app
  // with no signal, the fallback fetched /offline, failed, and the browser's
  // own error page came back — the stand-in was unreachable by definition.
  //
  // A revision string rather than `null`: null means "never revalidate", which
  // would pin the first copy of this page's build-specific chunk list forever.
  // Bump it when the offline page's markup changes materially.
  precacheEntries: [
    ...(self.__SW_MANIFEST ?? []),
    { url: '/offline', revision: 'offline-v1' },
  ],
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

// Controlled-update handshake, plus the VAPID key handshake.
//
// The update banner posts SKIP_WAITING to the WAITING service worker when the
// user taps "Reload"; we then activate (skipWaiting was false, so the worker
// was parked). Activation fires `controllerchange` in the page, which the
// banner uses to reload into the new bundle.
//
// ⚠️ PUSH_VAPID_KEY is the other direction, and it exists because a service
// worker CANNOT re-subscribe to push without the application server key — and
// it has no way to obtain it: the key comes from GET /push/vapid-public-key,
// which is a different origin from the worker's in this deployment, and the
// worker holds no auth token anyway. So the page hands it over on every load
// (lib/use-push.ts). A worker woken by `pushsubscriptionchange` before any
// page has run in this browser session has no key and asks the page instead —
// see that handler below for what that does and does not cover.
let vapidPublicKey: string | null = null;

self.addEventListener('message', (event) => {
  const data = (event as ExtendableMessageEvent).data as
    | { type?: string; key?: unknown }
    | undefined;
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data?.type === 'PUSH_VAPID_KEY' && typeof data.key === 'string') {
    vapidPublicKey = data.key;
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
/**
 * The `badge` option passed to showNotification is the monochrome status-bar
 * glyph, NOT the launcher/app-icon count. Android and Samsung launchers only
 * show a count when the site uses the Badging API, so mirror the active
 * notification count onto the installed app icon here. Unsupported browsers
 * simply no-op.
 */
type AppBadgeNavigator = WorkerNavigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * ⚠️ TWO WRITERS, ONE ICON — SO ONE OF THEM HAS TO STAND DOWN.
 *
 * The tab bar polls /notifications/me/active-count every 15s and mirrors THAT
 * number onto the app icon (components/bottom-tab-bar.tsx). This file used to
 * mirror a different number onto the same icon: the count of notifications
 * sitting in the OS shade. While the app was open the two fought, and the icon
 * flipped between "3 unread" and "1 in the shade" depending on which wrote
 * last — a badge that changes number while the member is looking at it reads as
 * broken.
 *
 * The rule now is ownership by visibility: while a window of this app is
 * VISIBLE the page owns the icon (its number is the true unread count), and the
 * worker owns it only when nothing is on screen — which is exactly the case the
 * page cannot cover, because its 15s poll is suspended in the background.
 *
 * Consequence, stated plainly: a push that lands while the member is in the app
 * updates the notification list but not the icon, until the page's own poll
 * fires (≤15s). That is the correct trade — one authoritative number, slightly
 * late, instead of two sources alternating.
 */
async function appHasVisibleWindow(): Promise<boolean> {
  try {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    return windows.some((c) => (c as WindowClient).visibilityState === 'visible');
  } catch {
    return false;
  }
}

async function syncAppBadge(): Promise<void> {
  try {
    if (await appHasVisibleWindow()) return;
    const notifications = await self.registration.getNotifications();
    const nav = self.navigator as AppBadgeNavigator;
    if (notifications.length > 0) {
      await nav.setAppBadge?.(notifications.length);
    } else {
      await nav.clearAppBadge?.();
    }
  } catch {
    /* Badging API unsupported or denied - the OS notification still shows. */
  }
}

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
    // Plain-text fallback - backend always sends JSON but defend
    // against partner-injected pushes anyway.
    payload = { title: 'ALL Outdoor', body: e.data.text() };
  }
  const title = payload.title ?? 'ALL Outdoor';
  const body = payload.body ?? '';
  // ⚠️ NORMALISED HERE, NOT IN THE BACKEND. Rows written on a tunnel or a dev
  // host keep that absolute URL forever (see lib/app-url.ts), and a tap that
  // follows one leaves the installed app for a dead domain. Reducing it to a
  // path means the tap resolves against whatever host the member is on.
  const target = stripToAppPath(payload.url ?? '/', self.location.origin);
  e.waitUntil(
    (async () => {
      // ⚠️ TYPED AS AN INTERSECTION, NOT A LITERAL. `renotify` and `timestamp`
      // are valid NotificationOptions members in the push spec and in every
      // shipping engine, but TypeScript's lib.dom has never declared either —
      // so passing the object inline is an excess-property error. Widening the
      // variable keeps both properties (which is the whole point) without a
      // cast that would also silence real mistakes.
      const options: NotificationOptions & {
        renotify?: boolean;
        timestamp?: number;
      } = {
        body,
        icon: '/icon-192.png',
        // Monochrome white-on-transparent glyph - Android renders the badge
        // as a single-colour alpha mask; a full-colour icon degrades to a
        // grey blob in the status bar.
        badge: '/notification-icon.png',
        tag: payload.tag,
        // ⚠️ renotify IS THE DIFFERENCE BETWEEN "OUTBID AGAIN" AND SILENCE.
        // `tag` replaces the previous notification for the same entity, and a
        // replacement that does not renotify makes no sound and does not buzz:
        // the second outbid on an auction — the one that actually costs the
        // member the item — arrives in total silence. `renotify` is only valid
        // alongside a tag (Chrome throws without one), hence the guard.
        renotify: Boolean(payload.tag),
        // Without this the shade shows no time on the notification, and iOS
        // sorts it by when the push service happened to deliver it.
        timestamp: Date.now(),
        data: { url: target },
        requireInteraction: false,
      };
      await self.registration.showNotification(title, options);
      await syncAppBadge();
    })(),
  );
});

// Tapping the notification opens (or focuses) the deep-link URL.
// If the PWA is already running in a tab/window we focus it; else
// we open a new one.
self.addEventListener('notificationclick', (event) => {
  const e = event as NotificationEvent;
  e.notification.close();
  const target = stripToAppPath(
    (e.notification.data as { url?: string } | undefined)?.url ?? '/',
    self.location.origin,
  );
  e.waitUntil(
    (async () => {
      await syncAppBadge();
      // A path can be handed to an existing window; a URL on somebody else's
      // origin cannot (WindowClient.navigate rejects cross-origin), so it goes
      // to openWindow and lands wherever the member's browser decides.
      if (!target.startsWith('/')) {
        await self.clients.openWindow(target);
        return;
      }
      const absolute = new URL(target, self.location.origin).href;
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an existing tab on the same origin — saves a
      // hard reload and preserves session state.
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            await (client as WindowClient).navigate(absolute);
            await (client as WindowClient).focus();
            return;
          } catch {
            /* fall through to openWindow */
          }
        }
      }
      // Nothing to focus → open fresh.
      await self.clients.openWindow(absolute);
    })(),
  );
});

// Swiping a notification away must drop the launcher count too.
self.addEventListener('notificationclose', (event) => {
  const e = event as NotificationEvent;
  e.waitUntil(syncAppBadge());
});

// ─── Re-subscription ────────────────────────────────────────────────
//
// The day the browser rotates a push subscription, every push addressed to this
// device starts failing at the push service. Nothing on the sending side hears
// about it in a way it can act on: our backend only prunes a row on 404/410
// (a rotated subscription answers 401/403), so the row survives, looks healthy,
// and the member simply stops receiving notifications — for good, and without
// a single error the operator can see.
//
// This is the recovery path, in two arms:
//
//   1. WE HOLD THE VAPID KEY (the page posted it on this load). Re-subscribe
//      here, then hand the new subscription to every open window, which has the
//      auth token this worker does not and POSTs it to /push/subscribe.
//
//   2. WE DO NOT (the worker was woken cold). Ask the windows to redo the
//      subscription themselves; lib/use-push.ts owns that handler.
//
// ⚠️ WHAT NEITHER ARM COVERS: the app closed, the worker cold, the key unknown.
// That case cannot be recovered from inside the worker — persisting a
// subscription needs the member's token — and it is why the opt-in UI must stay
// visible on /settings rather than assuming push works. Do not "fix" this by
// having the worker POST without auth.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { newSubscription?: PushSubscription };
  e.waitUntil(
    (async () => {
      let next: PushSubscription | null = e.newSubscription ?? null;
      if (!next && vapidPublicKey) {
        try {
          next = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        } catch {
          next = null;
        }
      }
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      if (windows.length === 0) return;
      const subscription = next ? next.toJSON() : null;
      for (const client of windows) {
        // A null subscription is the "you do it" instruction.
        client.postMessage({ type: 'PUSH_RESUBSCRIBE', subscription });
      }
    })(),
  );
});
