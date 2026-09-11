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
//     shop, /admin/offline for the Desk. Which one answers a given failure is
//     decided in lib/desk-offline.ts, because nothing under app/ is collected
//     by vitest and a rule written here could never be tested.
//
// Kill switch: setting NEXT_PUBLIC_DISABLE_PWA=true at build time
// disables SW generation entirely. Useful if a caching bug ships.

import { defaultCache } from '@serwist/next/worker';
import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
  SerwistPlugin,
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
// written inline in this file can never go red. See lib/desk-offline.spec.ts;
// this file is the adapter that hands serwist what that module decides.
import {
  DESK_OFFLINE_URL,
  SHOP_OFFLINE_URL,
  deskOfflineFallbackApplies,
  deskOfflinePrecacheEntry,
  deskStandInInstallFailureIsTolerated,
  shopOfflineFallbackApplies,
} from '../lib/desk-offline';

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
    // SHOP_FALLBACK_EXCLUDES in lib/desk-offline.ts names the same paths for a
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

/**
 * THE DESK'S STAND-IN DOCUMENT, ADDED TO THE INSTALL-TIME PRECACHE BY HAND.
 *
 * 🚨 A SERWIST FALLBACK IS RESOLVED ONLY THROUGH `matchPrecache()`. No
 * precache key means `undefined` means the original error is rethrown and the
 * browser draws its own network page — so declaring a `fallbacks` entry for a
 * document that is not precached is decoration, not a feature. That is not a
 * theory: `globPublicPatterns` in next.config.mjs globs public/ and nothing
 * else, App Router HTML is not in public/, and a parse of the built
 * public/sw.js found 230 precache entries with `/offline` absent — only its JS
 * chunk present. The shop's fallback has been inert since it shipped.
 *
 * ⚠️ THE SHOP'S `/offline` IS DELIBERATELY NOT ADDED HERE. Switching on a
 * storefront page that has never once been served — on every visitor's phone,
 * as a side effect of an admin change — is its own decision and its own
 * commit. Phase 9 fixes the Desk and names the shop's gap.
 *
 * 🚨 AND IT IS THE ONE PRECACHE ENTRY WHOSE FAILURE MUST NOT SINK THE INSTALL.
 * A precache install is all-or-nothing: serwist's PrecacheStrategy throws on
 * any status >= 400 and rethrows a network failure, `Serwist.handleInstall`
 * awaits every entry inside `event.waitUntil`, and a rejected install means the
 * browser keeps NO service worker — for shoppers, not just the operator. Every
 * other url in the injected manifest is a file on disk — 169 build artefacts
 * under `/_next/static/` and 63 globbed out of `public/`, counted off a built
 * public/sw.js rather than assumed. This is the only RENDERED ROUTE in the
 * list, and it sits under a path an edge rule can plausibly be pointed at: an
 * IP allowlist on /admin, an access policy, a middleware change, a deploy
 * where the route 404s. So a Desk-only stand-in was gating the storefront's
 * PWA. `tolerateDeskStandInInstallFailure` below
 * is the narrowing; `deskStandInInstallFailureIsTolerated` in lib/ is the rule
 * it asks, and the spec is what stops that rule widening.
 *
 * ⚠️ AND IT IS FETCHED ANONYMOUSLY AT INSTALL TIME, by every visitor's service
 * worker, shopper or not. That is safe only because of what the document is:
 * `/admin(.*)` is public in middleware.ts (the Desk runs its own JWT and gates
 * client-side), so the server hands over the HTML — and the page therefore
 * carries no figure, no board name beyond what the manifest already publishes,
 * and no member data. See app/admin/offline/page.tsx.
 *
 * 🚨 THE INJECTION POINT IS READ EXACTLY ONCE, INTO THIS CONST, AND IT HAS TO
 * BE. `__SW_MANIFEST` on `self` is not a variable — it is a marker the serwist
 * webpack plugin rewrites, and it counts occurrences in the SOURCE. Naming it
 * twice fails the build outright: "Multiple instances ... were found in your
 * SW source. Include it only once." The obvious shape — reading it once to
 * derive the stamp and again to spread it — is the one that does not compile,
 * and it fails at `next build`, which on this repo is the only real gate.
 *
 * ⚠️ WHICH IS ALSO WHY THIS COMMENT SPELLS THE MARKER IN TWO PIECES. A source
 * scan that counts a literal counts it inside prose too; writing the full
 * token here to explain the rule would break the rule.
 */
const injectedManifest = self.__SW_MANIFEST;
const deskOffline = deskOfflinePrecacheEntry(injectedManifest);

/**
 * WHAT THE SHOPPER'S SERVICE WORKER IS ALLOWED TO LOSE.
 *
 * 🚨 THIS IS THE WHOLE BLAST-RADIUS FIX, AND IT IS DELIBERATELY THE SMALLEST
 * ONE THAT KEEPS THE PAGE THERE WHEN IT IS NEEDED. The alternative considered
 * was caching the stand-in at RUNTIME on the first admin navigation, which has
 * no blast radius at all — but a stand-in that exists only after a successful
 * visit is missing from exactly the browser that most needs it, and it would
 * mean leaving serwist's `matchPrecache()` path (the only thing `fallbacks`
 * consults) for a hand-rolled cache with its own freshness and its own
 * cleanup. Precaching stays; only the failure changes shape.
 *
 * `handlerDidError` is consulted by `Strategy._getResponse` when `_handle`
 * throws; returning a response there means the entry is treated as handled and
 * `handleInstall` resolves. Nothing is written to the cache on this path —
 * `_handleInstall` throws only AFTER `cachePut` has already refused the
 * response — so the outcome is an install that succeeds with this one url
 * absent from the precache, not one that stores a broken page.
 *
 * ⚠️ WHAT THIS GIVES UP, SAID PLAINLY: when it fires, the operator's stand-in
 * is silently not there, and the service worker has nowhere to report that.
 * The Health board's "Offline stand-in" row is now the ONLY place a failed
 * stand-in fetch is visible, and it is visible only on the device it is true
 * of and only when somebody opens it. That was already the row's job; it is no
 * longer its only job.
 *
 * ⚠️ AND IT IS A PRODUCTION-BUILD BEHAVIOUR. In a service-worker bundle built
 * with NODE_ENV !== 'production', serwist's own `_getResponse` re-throws from
 * this very branch after logging (Strategy.ts: `throw logger.log(...)`), so
 * the rescue does not apply there. Next only generates this worker during
 * `next build`, which defines production — but a future SW build mode that
 * does not would take the rescue away without changing a line of this file.
 */
const tolerateDeskStandInInstallFailure: SerwistPlugin = {
  handlerDidError: async ({ event, request }) =>
    deskStandInInstallFailureIsTolerated(event?.type, request.url)
      ? // No body, and not a 200: nothing reads this response — `handleInstall`
        // only awaits it — and a 204 cannot be mistaken for a page if anything
        // ever does.
        new Response(null, { status: 204, statusText: 'stand-in not stored' })
      : undefined,
};

const serwist = new Serwist({
  precacheEntries: deskOffline
    ? [...(injectedManifest ?? []), deskOffline]
    : injectedManifest,
  // ⚠️ ADDS A PLUGIN, CHANGES NOTHING ELSE. `parsePrecacheOptions` spreads
  // `plugins` in front of serwist's own PrecacheCacheKeyPlugin and defaults
  // every other field it reads, so passing this object does not quietly drop
  // the cache name, the concurrency limit or the network fallback.
  precacheOptions: { plugins: [tolerateDeskStandInInstallFailure] },
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
  // 🚨 "ADMIN PAGES NEVER FALL BACK" WAS TRUE HERE UNTIL PHASE 9, AND THE
  // REASON IT GAVE IS STILL RIGHT. A cached admin page is a number the
  // operator acts on that stopped being true, and a cached "0 things need you"
  // is the worst thing that panel could render. What changed is not the rule
  // but what /admin falls back TO: a static document that shows no figure at
  // all. The board itself is still never cached — the /admin NetworkOnly rule
  // above is untouched and `/api/*` stays network-only permanently — so the
  // failure is still visible. It is the whole page. It simply says so in the
  // Desk's own skin, with the last successful read and a retry, instead of in
  // the browser's.
  //
  // ⚠️ THE ORDER OF THESE TWO ENTRIES IS NOT LOAD-BEARING AND MUST NOT BECOME
  // SO. serwist's PrecacheFallbackPlugin walks the list, takes the first
  // matcher that returns true, and — if THAT url is not in the precache —
  // carries on to the next. The two matchers partition document requests
  // between them (see lib/desk-offline.ts), so no request can match both; the
  // Desk entry is written first only because it is the narrower rule.
  //
  // ⚠️ A FALLBACK PLUGIN IS ATTACHED TO EVERY RUNTIME STRATEGY, NOT JUST THE
  // NAVIGATION ONE — serwist pushes it onto each handler in `runtimeCaching`,
  // NetworkOnly included, which is what lets an /admin navigation reach a
  // fallback at all despite never being cached. It is also why both matchers
  // test `destination === 'document'` first: without it a failed /admin image
  // or a failed /admin fetch would each be answered with a page of HTML.
  fallbacks: {
    entries: [
      {
        url: DESK_OFFLINE_URL,
        // The matcher is handed `request` and not `url`, so the pathname is
        // derived here — same as the shop entry below.
        matcher: ({ request }) =>
          deskOfflineFallbackApplies(request.destination, new URL(request.url).pathname),
      },
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
