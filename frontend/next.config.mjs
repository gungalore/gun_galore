import withSerwistInit from '@serwist/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  },
  images: {
    remotePatterns: [
      // User-uploaded photos (listings, KYC docs, etc.).
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      // Clerk-hosted avatars + initial fallbacks. Both hostnames appear
      // in the wild — `img.clerk.com` is the new format, `images.clerk.dev`
      // is the legacy one — so allowlist both.
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'images.clerk.dev',
      },
    ],
  },
  // Security headers (audit H9 + H10 + HDR-4). Applied to every route.
  // CSP intentionally only sets `frame-ancestors` for now — a full
  // script-src / connect-src CSP needs per-environment tuning (Clerk,
  // Cloudinary, Stitch checkout origin, Anthropic) and Report-Only
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
  // 🚨 KEEP THE DOCUMENT-SCANNER MODEL OUT OF THE INSTALL-TIME PRECACHE.
  //
  // Serwist's default is globPublicPatterns: ['**/*'] — every file under
  // public/. public/ is 27 MB, and 23 MB of that is two files:
  // scan/v1/docquad.ort (12.8 MB) and scan/v1/ort-wasm-simd.wasm (10.1 MB),
  // the DocQuadNet256 weights and the ONNX runtime. Both were in the LIVE
  // sw.js precache manifest, so every visitor whose service worker installed
  // downloaded ~23 MB before seeing a single listing — for a scanner that only
  // ever runs inside KYC / motivation document capture, which most shoppers
  // never open. On the mobile data this marketplace is built for, that is the
  // whole install budget spent on a feature the visitor has not asked for.
  //
  // ⚠️ THE PATTERN LOOKS ODD BECAUSE `!` NEGATION DOES NOT WORK HERE. Serwist
  // calls globSync(patterns, {cwd: 'public'}) and modern glob has no negation
  // in the pattern list — it takes an `ignore` option, which serwist hard-codes
  // and does not expose. Verified empirically: ['**/*', '!scan/v1/**'] returns
  // the identical 61 files, model included. This extglob form was checked by
  // set-comparison against ['**/*'] minus the two model files and matches it
  // EXACTLY — 59 files, nothing else added or dropped.
  //
  // The obvious-looking alternative — listing the wanted directories — was
  // wrong in a way worth recording: it silently ADDED .well-known/security.txt,
  // because glob skips dotfiles under `**/*` but not under an explicit
  // `.well-known/**`.
  //
  // ⚠️ A NEW TOP-LEVEL DIRECTORY IN public/ IS STILL PRECACHED by this pattern.
  // Only `scan` is excluded. If another large asset tree lands, exclude it here
  // too — `!(scan|whatever)/**/*`.
  //
  // The scanner still works: nothing here stops it being fetched on demand when
  // the capture flow opens, it is simply no longer downloaded up front.
  globPublicPatterns: ['*', '!(scan)/**/*'],
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
