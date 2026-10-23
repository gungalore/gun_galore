import { NextResponse } from 'next/server';
import type { MetadataRoute } from 'next';
import { av } from '@/lib/asset-version';
import { SITE_URL } from '@/lib/brand';

/**
 * THE SHOP'S MANIFEST — an explicit route, not `app/manifest.ts`.
 *
 * ⚠️ WHY IT MOVED OUT OF THE FILE CONVENTION (2026-10-23). Next's file-based
 * `manifest.ts` emits its `<link rel="manifest">` for EVERY route, including
 * `/admin/*`, and it wins over a nested layout's `metadata.manifest`. The
 * admin layout has always declared `/admin/manifest.webmanifest`, but the
 * live admin HTML was still serving the shop manifest — so an iOS "Add to
 * Home Screen" installed a shop app whose start_url is `/`. Two manifests,
 * two explicit metadata overrides, one link per page; the file convention
 * cannot express that.
 *
 * The content is otherwise unchanged: id/start_url/scope are `/`, and
 * scripts/theme-sync.cjs still reads the two colour literals below.
 */
const manifest: MetadataRoute.Manifest & { colors?: string[] } = {
  id: '/',
  name: 'ALL Outdoor',
  short_name: 'ALL Outdoor',
  description:
    'South Africa’s new and secondhand outdoor store — camping, overlanding, fishing and outdoor clothing.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  // ⚠️ KEEP BOTH EQUAL TO --bg IN app/globals.css. Three places name this
  // colour (globals.css, here, and layout.tsx's viewport themeColor) and
  // scripts/theme-sync.cjs fails the build when they drift.
  background_color: '#F7F6F3',
  theme_color: '#F7F6F3',
  // Chrome picks the splash / status bar colour that matches the current
  // theme. [light, dark].
  colors: ['#F7F6F3', '#131110'],
  categories: ['shopping', 'sports', 'lifestyle'],
  lang: 'en-ZA',
  prefer_related_applications: false,
  // This URL must match the manifest URL of the page being viewed, or
  // navigator.getInstalledRelatedApps() never reports this PWA as installed.
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
  ],
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

export function GET() {
  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
