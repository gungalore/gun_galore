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
  reloadOnOnline: true,
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
