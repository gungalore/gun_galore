import type { MetadataRoute } from 'next';
import { av } from '@/lib/asset-version';
import { SITE_URL } from '@/lib/brand';

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
    // ⚠️ THIS IS THE SPLASH, ON ANDROID. Chrome composes the launch screen
    // from `name`, `background_color` and the 512px icon below — there is no
    // separate splash asset to author, and getting `background_color` wrong is
    // the whole bug (a white flash before a near-black app).
    //
    // ⚠️ iOS IS NOT COVERED BY ANY OF THIS, and saying so is the point of the
    // note. Safari ignores background_color and paints a launch image from
    // <link rel="apple-touch-startup-image"> — the shop wires a set of those
    // in app/layout.tsx against public/splash/. The Desk has no such images
    // and no such links, so an installed Desk on an iPhone launches on a blank
    // screen. Fixing it needs new artwork AND a change to
    // app/admin/desk/layout.tsx; neither belongs to the manifest.
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
    /**
     * ⚠️ THESE TWO ARE WHAT MAKES "IS THE DESK ALREADY INSTALLED?" ANSWERABLE
     * FROM A TAB. Without a `related_applications` entry,
     * getInstalledRelatedApps() has nothing to match and always answers
     * empty — so an installed Desk browsed in an ordinary Chrome tab reads as
     * NOT installed, because display-mode is only `standalone` inside the
     * installed window. The Health board's Install row would then go on
     * offering an install to somebody who has already done it, which is the
     * exact nag the shop's manifest carries the same two fields to prevent.
     *
     * ⚠️ THE URL MUST BE THE DESK'S MANIFEST, NOT THE SHOP'S. It has to match
     * the manifest of the page being viewed or the match never happens — the
     * shop's copy of this field was hardcoded to the retired domain and
     * survived the rebrand, which is why both now read from the same env the
     * canonical URL uses.
     */
    prefer_related_applications: false,
    related_applications: [
      {
        platform: 'webapp',
        url: `${SITE_URL}/admin/manifest.webmanifest`,
      },
    ],
    /**
     * THE FOUR SURFACES — the same four DESK_TABS draws, in the same order.
     *
     * 🚨 THE LIST THIS REPLACES POINTED AT THREE THINGS THAT ARE NO LONGER
     * BOARDS, and nothing anywhere said so. It named `/admin/desk/ledger` and
     * `/admin/desk/site`, both of which are now `route.ts` redirects, and
     * `/admin/desk/pulse`, whose page was deleted outright. A launcher
     * shortcut is a COLD START: the window opens, the redirect resolves, and
     * the operator watches an empty frame on the way to somewhere they did not
     * ask for — or, for Pulse, a 404 inside their own installed app. It is the
     * same failure `start_url` already avoids by being /admin/desk rather than
     * /admin, one level out.
     *
     * ⚠️ HAND-WRITTEN RATHER THAN IMPORTED FROM DESK_TABS, and the reason is
     * not laziness: components/desk/tabs.tsx is a 'use client' module that
     * imports next/link and the icon set, and this file is read by a manifest
     * route handler. Importing it would drag React components into a JSON
     * response. lib/desk-manifest.spec.ts is what keeps the two honest — it
     * fails if any URL here is not a real page under app/admin/desk.
     *
     * ⚠️ THE PILE IS INCLUDED EVEN THOUGH IT IS ALSO `start_url`. There are
     * exactly four surfaces and a launcher menu has room for them, so nothing
     * is displaced by the duplication — and a menu that lists every board is
     * one an operator can trust without first working out which one the icon
     * opens.
     *
     * ⚠️ EVERY URL MUST BE INSIDE `scope`. A shortcut that leaves /admin opens
     * in a browser tab rather than the installed window, silently, and the
     * operator ends up signed in twice in two different frames.
     */
    shortcuts: [
      {
        name: 'Now',
        short_name: 'Now',
        description: 'The pile — today’s cards',
        url: '/admin/desk',
      },
      {
        name: 'People',
        short_name: 'People',
        description: 'Members, sellers and admins',
        url: '/admin/desk/people',
      },
      {
        name: 'Health',
        short_name: 'Health',
        description: 'Gates, channels, queues and this device',
        url: '/admin/desk/health',
      },
      {
        name: 'Agent',
        short_name: 'Agent',
        description: 'Warden’s proposals and runs',
        url: '/admin/desk/agent',
      },
    ],
  };
}
