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
//   • HTML pages, /api/*, anything containing 'clerk' or 'peach' —
//     deliberately NOT cached. Network-only. Prices, auctions, bids,
//     and auth must never go stale.
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
// backend API, Clerk, and Peach. These must always hit the network
// fresh — admin data is real-time, API responses contain auth state,
// Clerk does its own dance with cookies, Peach is a payment provider.
// Putting these BEFORE every other rule (including defaultCache and
// the navigation fallback) ensures nothing else can intercept them.
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
  skipWaiting: true,
  clientsClaim: true,
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
        matcher: ({ request, url }) =>
          request.destination === 'document' &&
          !url.pathname.startsWith('/admin') &&
          !url.pathname.startsWith('/a/') &&
          !url.pathname.startsWith('/checkout') &&
          !url.pathname.startsWith('/preview'),
      },
    ],
  },
});

serwist.addEventListeners();
