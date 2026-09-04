import type { MetadataRoute } from 'next';
import { av } from '@/lib/asset-version';

/**
 * THE DESK — its own installable app, separate from the shop.
 *
 * 🚨 WITHOUT THIS FILE THERE IS NO ADMIN PWA AT ALL. app/manifest.ts is linked
 * from every route including /admin, and it declares `id: '/'`,
 * `start_url: '/'`, `scope: '/'`. So "Add to Home Screen" from the Desk read
 * the SHOP's manifest and installed the shop: shop name, shop icon, and a
 * launch straight into the storefront. There was nothing an operator could do
 * on the phone about it — the fix is a second manifest, which is this one.
 *
 * Next resolves metadata per route segment, so a manifest under app/admin
 * overrides the root link for /admin/* and leaves the shop's untouched.
 *
 * ⚠️ `id` MUST DIFFER FROM THE SHOP'S. The id, not the URL, is what a browser
 * uses to decide whether it already has an app installed. Two manifests
 * sharing `id: '/'` are the same app wearing two names, and installing the
 * second silently updates the first — which would replace the shop on the
 * home screen with the Desk.
 *
 * ⚠️ `scope: '/admin'` KEEPS THE INSTALLED WINDOW ON THE DESK. Outside its
 * scope a standalone app hands the link to the browser, so a scope of '/'
 * would mean tapping anything that leaves /admin quietly drops the operator
 * into a normal tab, still signed in, with no way back into the app frame.
 *
 * ⚠️ THE COLOURS ARE THE DESK'S, NOT THE SHOP'S. #101312 is --dk-ground. The
 * shop launches cream; this one has to launch dark or every start shows a
 * white flash before a near-black app. app/admin/desk/layout.tsx sets the
 * matching theme-color meta for the browser chrome.
 */
export function deskManifest(): MetadataRoute.Manifest {
  return {
    id: '/admin/desk',
    name: 'All Outdoor Desk',
    // What sits under the icon on a home screen. Kept to one word: anything
    // longer is truncated by the launcher anyway, and "All Outdoor D…" beside
    // the shop's "All Outdoor" is worse than no second app.
    short_name: 'Desk',
    description: 'The All Outdoor admin desk — the pile, the ledger, people and site health.',
    // The pile, not /admin: /admin only redirects, so launching there would
    // show a blank frame for one hop on every cold start.
    start_url: '/admin/desk',
    scope: '/admin',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#101312',
    theme_color: '#101312',
    lang: 'en-ZA',
    // Deliberately NOT in the shop's categories — this is not a shopping app
    // and should never be offered as one.
    categories: ['business', 'productivity'],
    icons: [
      {
        src: av('/icon-desk-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: av('/icon-desk-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // The same mark inside the centre 56%, so a circular or squircle
      // launcher mask cannot clip it. An icon offered as maskable whose
      // content runs to the edge loses its corners on most Android launchers.
      {
        src: av('/icon-desk-maskable-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: av('/icon-desk-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'The pile',
        short_name: 'Pile',
        description: 'Today’s cards',
        url: '/admin/desk',
      },
      {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'The payout run and the order book',
        url: '/admin/desk/ledger',
      },
      {
        name: 'Site health',
        short_name: 'Site',
        description: 'Gates, channels and Warden',
        url: '/admin/desk/site',
      },
    ],
  };
}
