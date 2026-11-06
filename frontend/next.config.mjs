import withSerwistInit from '@serwist/next';

const localApiProxy = process.env.LOCAL_API_PROXY === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow Next.js dev resources (HMR, etc.) when accessing via ngrok tunnel
  // during local testing. Without this, dev-only features are blocked for
  // cross-origin access.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.dev'],

  // Explicit empty Turbopack config — Next 16 runs Turbopack by
  // default in dev, but @serwist/next adds a webpack-only plugin
  // below. Without this, Next 16 errors out at startup with
  // "build is using Turbopack with a webpack config". The Serwist
  // plugin is a no-op under Turbopack anyway (the SW is generated
  // only in `next build`, not in dev), so an empty turbopack config
  // is enough to silence the conflict.
  turbopack: {},
  // Enable React's <ViewTransition> component — wraps every route
  // change in a transition so the existing
  // `html[data-standalone='true']::view-transition-old/new(root)`
  // keyframes in globals.css fire during navigation. Result: the
  // installed PWA slides between routes (180ms fade out + 280ms
  // slide-in) instead of doing a hard cut. Browser-mode users keep
  // the standard navigation feel (CSS rules are scoped to
  // standalone). Falls back gracefully on browsers that don't
  // implement the View Transitions API (Safari < 18) — the page
  // just navigates instantly with no animation.
  experimental: {
    viewTransition: true,
    /**
     * ⚠️ RAISED OFF THE 30s DEFAULT, AND NOT COSMETIC. When LOCAL_API_PROXY is
     * on, every browser call to /api/* is proxied to the backend by Next's dev
     * proxy, which aborts a proxied request after 30 seconds
     * (proxy-request.js: `n || 30_000`). A five-document identify walks the
     * vision model file by file and took 47s, so the upload died as "it
     * failed" — with no error from the backend, which was still working. The
     * server is also capped at three files in flight now (see
     * IDENTIFY_CONCURRENCY), but a large batch or a slow provider can still run
     * long, and a local timeout is never the answer we want to show a member.
     */
    proxyTimeout: 300_000,
    /**
     * ⚠️ THE 10MB DEFAULT TRUNCATED BATCH UPLOADS. Sixteen documents arrive in
     * one identify request; Next buffers the proxied body and kept only the
     * first 10MB, so multer saw an incomplete multipart stream and the member
     * got a spinner that never finished. The backend's own per-file cap is
     * 10MB, but a batch is legitimately much larger.
     */
    proxyClientMaxBodySize: '256mb',
  },
  /**
   * The retired motivation surfaces.
   *
   * ⚠️ 301, NOT 302, AND NOT A DELETION. Both wizards were removed on
   * 2026-09-08 (Phase 4), and members carry these paths in bookmarks, in
   * reminder emails and in SMS action links that were sent before today. A 404
   * on a link we sent is worse than a redirect that outlives its usefulness.
   *
   * ⚠️ `/licence-services/new` MUST COME BEFORE `/licence-services/:id`, or
   * Next matches the dynamic segment first and sends somebody starting a new
   * application to a sheet whose id is the word "new".
   *
   * ⚠️ AND `/licence-centre` IS NOT HERE, deliberately. It is the Document
   * Centre's own second door and still serves that page — see
   * app/documents/page.tsx and notification-module.ts, which deep-links every
   * licence_centre_* reminder to it. That is why the applications list took a
   * child path rather than the index.
   */
  async redirects() {
    return [
      { source: '/motivations', destination: '/licence-centre/applications', permanent: true },
      { source: '/licence-services/new', destination: '/licence-centre/applications', permanent: true },
      { source: '/motivations/:id', destination: '/licence-centre/:id', permanent: true },
      { source: '/licence-services/:id', destination: '/licence-centre/:id', permanent: true },
      /**
       * The retired payment explainers.
       *
       * ⚠️ CONFIGURED HERE, NOT AS A PAGE THAT CALLS permanentRedirect(). A
       * redirect-only page under a static layout is prerendered, so the
       * response is a 200 whose RSC payload carries the redirect digest — a
       * crawler sees a soft 200 and the URL stays indexable. A config redirect
       * answers with a real 308 before Next renders anything.
       *
       * The destinations carry the anchors of the paragraphs that now hold the
       * binding text (Terms 7 and 11).
       */
      {
        source: '/how-payments-work',
        destination: '/terms#payments',
        permanent: true,
      },
      {
        source: '/buyer-protection',
        destination: '/terms#buyer-protection',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return localApiProxy
      ? [
          {
            source: '/api/:path*',
            destination: 'http://localhost:3001/api/:path*',
          },
        ]
      : [];
  },
  images: {
    remotePatterns: [
      // User-uploaded photos (listings, KYC docs, etc.).
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      // ⚠️ THE IDENTITY PROVIDER'S AVATAR HOSTS ARE GONE FROM THIS LIST, and
      // that is only safe because avatars moved to Cloudinary above. If a row
      // somewhere still holds an img.clerk.com URL, next/image will refuse it
      // with a 400 rather than rendering a broken image — which is the loud
      // failure you want, not a silent one.
    ],
  },
  // Security headers (audit H9 + H10 + HDR-4). Applied to every route.
  // CSP intentionally only sets `frame-ancestors` for now — a full
  // script-src / connect-src CSP needs per-environment tuning (Cloudinary,
  // Didit's hosted verification, the payment gateway) and Report-Only
  // observation before enforcement. The frame-ancestors directive
  // alone gives us anti-clickjacking and is safe to ship today.
  //
  // The Cache-Control header overrides Next's default 1-year `s-maxage`
  // on prerendered HTML (audit H10) — that default risked a shared
  // cache pinning "Coming Soon" / outdated legal copy for a year. We
  // keep static asset caching (/_next/static/*) untouched since those
  // are content-hashed and safe to cache aggressively.
  async headers() {
    const securityHeaders = [
      // HSTS is set at the CDN edge (Cloudflare) per audit H8 — kept
      // out of here so we don't accidentally override the edge config.
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Sensible default — apps can request camera/geolocation/etc. via
      // explicit user gesture (covered by the browser permission prompt
      // even when the policy is empty), so we deny everything else.
      {
        key: 'Permissions-Policy',
        value:
          'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=(), magnetometer=(self), accelerometer=(self), gyroscope=(self)',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'none'",
      },
    ];
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Dynamic HTML/SSR routes must be LIVE: a newly published listing
        // appears immediately and a cancelled/sold one disappears
        // immediately, with no edge staleness. `private` forbids any
        // shared cache (Cloudflare) from holding a snapshot — this kills
        // the staleness landmine even if a "Cache Everything" CDN rule is
        // ever switched on. `no-cache, must-revalidate` lets the browser
        // keep a copy but always revalidate with the origin before reuse
        // (so it stays fresh AND remains bfcache-eligible for snappy
        // back/forward). Fingerprinted assets under /_next/static/* are
        // matched LAST by Next.js and keep their immutable cache, so the
        // app shell / JS / CSS / images stay CDN-cached — that's where the
        // snappiness comes from, not from caching the dynamic HTML.
        source: '/((?!_next/static|_next/image|favicon).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },
};

// PWA service worker wiring via @serwist/next.
//
// • swSrc → the TypeScript source compiled into /sw.js (precache list
//   injected at build time).
// • swDest → public URL of the compiled worker.
// • disable → kill switch via NEXT_PUBLIC_DISABLE_PWA=true. When true,
//   the SW is not generated AND the registration helper in layout.tsx
//   unregisters any existing SW on the client. That double-action is
//   how we remotely "kill" a buggy SW if we ever ship one.
// • cacheOnFrontEndNav → false because the conservative caching
//   strategy doesn't pre-cache HTML routes.
//
// The plugin hooks Next's Webpack build. Turbopack (used by `next
// dev`) does NOT run this plugin — so the SW only activates in
// production builds (`next build && next start`). That's expected.
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // 🚨 THIS IS AN ALLOWLIST NOW, NOT AN EXCLUSION PATTERN. Read the next
  // paragraph before adding anything back to it.
  //
  // It used to read ['*', '!(scan)/**/*'] — "everything under public/ except
  // the scanner". That kept the 13 MB ONNX model out, which was the problem it
  // was written for, and then quietly precached everything ELSE that landed in
  // public/: measured on 2026-11-06, 85 files totalling 8.2 MB, on top of
  // 5.7 MB of build assets. 14 MB of install-time download before the app is
  // allowed to be an app. The individual offenders:
  //
  //   • hero-video.mp4            2.49 MB — and app/sw.ts's own NetworkOnly
  //                               rule means the SW will never SERVE it from
  //                               cache. Downloaded, stored, unreachable.
  //   • pdfjs/…/pdf.worker.min.mjs 1.35 MB — the PDF preview worker, used only
  //                               inside the licence centre.
  //   • splash/ + splash-dark/    1.38 MB — 46 iOS launch images; any one
  //                               device matches exactly one of them.
  //   • install-steps/            0.38 MB — the iOS "Add to Home Screen" help.
  //   • swop.*, take-a-shot.*     retired features (see AGENTS.md), referenced
  //                               by nothing.
  //   • admin-mockup.html         a 90 KB design mockup, served to anyone at a
  //                               guessable path. Deleted from public/ on the
  //                               same day; the canonical copy is
  //                               docs/design/admin-pwa/mockup.html.
  //
  // ⚠️ AN EXCLUSION LIST CAN ONLY EVER BE AS GOOD AS THE PERSON WHO REMEMBERS
  // TO EXTEND IT. `!(scan|…)` grows by default; an allowlist grows only when
  // somebody deliberately adds a line here. That is the whole reason for the
  // change: the failure mode of the old form was silent and unbounded.
  //
  // ⚠️ `!` NEGATION DOES NOT WORK IN THIS OPTION, which is why the old form
  // used extglob. Serwist calls globSync(patterns, {cwd: 'public'}) and modern
  // glob has no negation in the pattern list — it takes an `ignore` option,
  // which serwist hard-codes and does not expose.
  //
  // Everything listed here is small, same-origin, and wanted on the very first
  // run: the install icon set, the monochrome notification glyph, the brand
  // marks, and the hero poster (the LCP image on desktop). Nothing else in
  // public/ needs to be on the device before it is asked for — the scanner
  // models, the PDF worker, the launch images and the listing photos are all
  // fetched on demand, which is what the runtime caches in app/sw.ts are for.
  globPublicPatterns: [
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-192.png',
    'icon-maskable-512.png',
    'apple-icon-180.png',
    'favicon.ico',
    'notification-icon.png',
    'hero-outdoor.webp',
    'brand/**/*',
  ],
  // H7 — DO NOT hard-reload on reconnect. Serwist's `online` listener
  // would trigger a full `location.reload()` the instant signal returns,
  // wiping in-progress React state — KYC selfie/ID capture, checkout
  // form, listing photos. The connection banner in app/layout.tsx
  // already shows a non-destructive "back online" hint, which is the
  // correct UX on a mobile-first PWA for shooters on flaky signal.
  reloadOnOnline: false,
  // SW is built only in production. Two reasons to disable in dev:
  //   1. Turbopack (Next 16 dev) doesn't run the Webpack-based Serwist
  //      plugin; explicit disable silences the warning.
  //   2. Caching in dev would interfere with HMR + make file changes
  //      mysteriously not appear until cache is cleared.
  // Setting NEXT_PUBLIC_DISABLE_PWA=true in production forces the same
  // disabled state — that's the remote kill switch for shipping a
  // working build with the SW turned off if we ever need to.
  disable:
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_DISABLE_PWA === 'true',
});

export default withSerwist(nextConfig);
