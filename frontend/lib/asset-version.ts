// Cache-busting for long-lived static assets in /public.
//
// WHY THIS EXISTS
//
// Cloudflare sits in front of the origin and caches /public with
// `Cache-Control: public, max-age=2592000` — THIRTY DAYS. When the brand
// assets were replaced on 2026-08-12 the origin served the new files
// immediately, but the edge kept serving the old ones: `cf-cache-status: HIT`,
// `Age: 45392`. Ten assets were affected, and they were the worst ten to have
// wrong — og-default.jpg (the image Meta fetches for every WhatsApp share, and
// it was still the rifle photograph), logo.svg on every page, favicon.ico in
// every browser tab and in the Google SERP, and all six PWA icons.
//
// Changing the origin's headers does not help: entries already in the edge
// cache are not revalidated until they expire. Purging Cloudflare fixes it in
// one click but needs dashboard access, so the URL itself carries a version.
//
// WHEN YOU REPLACE AN ASSET IN /public UNDER ONE OF THESE NAMES, BUMP THIS.
// A file whose name never changes but whose bytes do is invisible to every
// cache between here and the user.
//
// Not needed for: anything under /_next/ (Next fingerprints those itself),
// Cloudinary URLs (already versioned), or a genuinely new filename.
export const ASSET_VERSION = '20260827b';

/** Append the asset version to a /public path. `av('/logo.svg')` */
export function av(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
}
