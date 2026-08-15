import type { MetadataRoute } from 'next';
import { av } from '@/lib/asset-version';
import { PRO_NAME, SITE_URL } from '@/lib/brand';

// PWA manifest — served at /manifest.webmanifest by Next.js when this
// file is present in the app dir. The combination of this manifest +
// the meta tags in layout.tsx is enough for browsers (Chrome, Edge,
// Samsung Internet, Safari) to surface "Add to Home Screen" and
// launch All Outdoor in standalone mode without browser chrome.
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
    name: 'All Outdoor',
    short_name: 'All Outdoor',
    description:
      'South Africa’s new and secondhand outdoor store — camping, overlanding, fishing, optics, knives and clothing.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f0f0f',
    theme_color: '#0f0f0f',
    categories: ['shopping', 'sports', 'lifestyle'],
    lang: 'en-ZA',
    // Lets navigator.getInstalledRelatedApps() actually report THIS PWA as
    // installed on Android Chrome — it matches the current page's manifest URL
    // against this 'webapp' entry. Without it we can never tell an installed
    // Android user apart from a first-timer, so we keep nagging them to install.
    // We still prefer the web app itself over any native app.
    prefer_related_applications: false,
    // ⚠️ This URL must match the manifest URL of the page being viewed, or
    // getInstalledRelatedApps() never matches and we nag installed users to
    // install forever — the exact failure this entry exists to prevent. It
    // was hardcoded to gungalore.co.za and survived the domain move, so it
    // reads from the same env the canonical URL uses.
    related_applications: [
      {
        platform: 'webapp',
        url: `${SITE_URL}/manifest.webmanifest`,
      },
    ],
    shortcuts: [
      {
        name: 'Browse the store',
        short_name: 'Browse',
        description: 'Browse everything in stock',
        url: '/',
        icons: [{ src: av('/icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Sell an item',
        short_name: 'Sell',
        description: 'Create a new listing',
        url: '/listings/new',
        icons: [{ src: av('/icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Live auctions',
        short_name: 'Auctions',
        description: 'Browse open auctions',
        url: '/?listingType=AUCTION',
        icons: [{ src: av('/icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Daily Deals',
        short_name: 'Deals',
        description: 'Today’s limited-time deal',
        url: '/deals',
        icons: [{ src: av('/icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Prize Draw',
        short_name: 'Prize Draw',
        description: `The ${PRO_NAME} members’ prize draw`,
        url: '/raffle',
        icons: [{ src: av('/icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
    ],
    // SCREENSHOTS REMOVED at the All Outdoor rebrand.
    //
    // These were live prod captures, so they still showed the old GUN-GALORE
    // bullet logo, the old "outdoor & sport marketplace" hero and the previous
    // copy — rendered full size inside Android's install dialog, which is
    // exactly the surface a reviewer looks at. A stale screenshot is worse
    // than none: Android just falls back to a plainer dialog without them.
    //
    // TO RESTORE: recapture at 390x844 @2x (780x1688), narrow form factor,
    // signed OUT so the public storefront is what appears, then re-add with
    // fresh labels. The old PNGs have since been deleted from /public, so
    // there is nothing to copy the framing from — recapture from scratch,
    // and do it AFTER public stock is loaded or the shot shows an empty shop.
    icons: [
      {
        src: av('/icon-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: av('/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: av('/icon-maskable-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: av('/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
