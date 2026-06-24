import type { MetadataRoute } from 'next';

// PWA manifest — served at /manifest.webmanifest by Next.js when this
// file is present in the app dir. The combination of this manifest +
// the meta tags in layout.tsx is enough for browsers (Chrome, Edge,
// Samsung Internet, Safari) to surface "Add to Home Screen" and
// launch Gun Galore in standalone mode without browser chrome.
//
// Phase C additions:
//   * `id` — explicit PWA identity, recommended so browsers don't
//     conflate variations of the install across launches.
//   * `shortcuts` — Android long-press-app-icon menu (Browse / Sell
//     / Auctions). iOS doesn't surface these (yet), but they're
//     harmless if present.
//   * `screenshots` — show preview cards on Android's richer install
//     dialog. Optional but polishes the install flow.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Gun Galore',
    short_name: 'Gun Galore',
    description:
      'South Africa’s verified outdoor, hunting and sport marketplace — optics, camping, fishing, knives and more.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f0f0f',
    theme_color: '#0f0f0f',
    categories: ['shopping', 'sports', 'lifestyle'],
    lang: 'en-ZA',
    shortcuts: [
      {
        name: 'Browse marketplace',
        short_name: 'Browse',
        description: 'Browse current listings',
        url: '/',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Sell an item',
        short_name: 'Sell',
        description: 'Create a new listing',
        url: '/listings/new',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Live auctions',
        short_name: 'Auctions',
        description: 'Browse open auctions',
        url: '/?listingType=AUCTION',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
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
