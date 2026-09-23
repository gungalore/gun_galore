import { NextResponse } from 'next/server';

/**
 * The admin PWA's own manifest.
 *
 * ⚠️ SCOPE IS /admin/. The shop's manifest claims `/`, so a manifest override
 * that left scope at the root would let the installed admin app capture shop
 * navigations (and vice versa). `/admin/manifest.webmanifest` is exempted in
 * middleware.ts so it is reachable without a member session.
 *
 * Icons are the shop's existing PNG set. A dedicated Warden mark is a design
 * task, not a routing one; when it exists it only has to replace these `src`
 * values.
 */
export function GET() {
  return NextResponse.json(
    {
      id: '/admin/warden',
      name: 'ALL Outdoor Warden',
      short_name: 'Warden',
      description: 'Operations console for ALL Outdoor.',
      start_url: '/admin/warden',
      scope: '/admin/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#030507',
      theme_color: '#030507',
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
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    },
  );
}
