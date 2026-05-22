import type { MetadataRoute } from 'next';

// PWA manifest — served at /manifest.webmanifest by Next.js when this
// file is present in the app dir. The combination of this manifest +
// the meta tags in layout.tsx is enough for browsers (Chrome, Edge,
// Samsung Internet, Safari) to surface "Add to Home Screen" and
// launch Gun Galore in standalone mode without browser chrome.
//
// Icons currently point at logo.svg — that works for most modern
// browsers but Phase B will replace these with proper PNG variants
// (192, 512, maskable) for sharper rendering on home screens and to
// satisfy stricter installability requirements on older Android.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Gun Galore',
    short_name: 'Gun Galore',
    description:
      'South Africa’s verified firearms, hunting and outdoor marketplace.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f0f0f',
    theme_color: '#0f0f0f',
    categories: ['shopping', 'sports', 'lifestyle'],
    lang: 'en-ZA',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
