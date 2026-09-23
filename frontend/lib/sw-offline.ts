/**
 * WHICH STAND-IN A FAILED NAVIGATION GETS — the shop's, or none.
 *
 * 🚨 THIS FILE IS COMPILED INTO THE SERVICE WORKER. app/sw.ts imports it, so
 * it may touch nothing that only exists in a window: no `document`, no
 * `localStorage`, no `next/*`.
 *
 * ⚠️ NOTHING UNDER app/ IS COLLECTED BY VITEST. `include` is
 * ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] — a rule written inside
 * app/sw.ts can never be tested, which is why the decidable part of the
 * service worker's behaviour lives here and app/sw.ts is a thin adapter over
 * it. See lib/sw-offline.spec.ts.
 *
 * ⚠️ THE DESK'S STAND-IN IS GONE WITH THE DESK (2026-09-22). The operator is
 * rebuilding the Desk, so `/admin/offline`, its precache entry and its
 * install-time rescue were all removed rather than carried. What survives is
 * the shop's half of the partition below.
 */

/** The shop's stand-in document. See app/offline/page.tsx. */
export const SHOP_OFFLINE_URL = '/offline';

/**
 * ⚠️ KEPT FOR THE DESK THAT WILL RETURN. A bare prefix, which also catches a
 * hypothetical `/admin-anything` — the same test app/sw.ts's NetworkOnly rule
 * makes. Until the rebuilt Desk ships there are no /admin routes, so this
 * exclusion is insurance rather than a live carve-out; a storefront stand-in
 * over a control room is the wrong product regardless, and keeping the entry
 * here means the rebuild does not have to remember it.
 */
export const ADMIN_PREFIX = '/admin';

/**
 * Paths the SHOP refuses to stand in for, and why each one is on the list.
 *
 * ⚠️ THESE ARE SEVERAL DIFFERENT REASONS WEARING ONE LIST.
 *
 *   • `/admin` — the rebuilt Desk will serve its own document; until then
 *     this is insurance. Either way the storefront's cream page is the wrong
 *     product for a control room.
 *
 *   • `/a/`, `/checkout`, `/preview` — single-use tokens and money. A stand-in
 *     page invites a retry against a request that may already have been spent.
 *
 *   • `/kyc` — hands off to the hosted identity session and needs the network
 *     for it. A stand-in misleads a seller who DOES have signal but hit a blip
 *     mid-capture into waiting instead of retrying.
 *
 *   • the five auth routes — the API has to be reachable for any of them to do
 *     anything, so a page that says "you are offline" over a sign-in form is a
 *     form somebody will fill in.
 *
 * ⚠️ THE AUTH ROUTES ARE NAMED TWICE IN THIS REPO — here and in app/sw.ts's
 * NetworkOnly matcher, for two different reasons (never cache them / never
 * stand in for them). Adding a sixth auth route means adding it to BOTH.
 */
const SHOP_FALLBACK_EXCLUDES = [
  ADMIN_PREFIX,
  '/a/',
  '/checkout',
  '/preview',
  '/kyc',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
] as const;

/**
 * Does the SHOP's stand-in document answer this failed request?
 *
 * Documents only. A fallback plugin is attached to EVERY runtime strategy, not
 * just the navigation one (serwist pushes it onto each handler in
 * `runtimeCaching`), so without the destination test a failed image or fetch
 * would be answered with a page of HTML.
 *
 * ⚠️ THE EXCLUSIONS ABOVE ARE A DECISION, NOT A GAP. Every document request
 * that fails gets the shop page, or — for the token, money, identity and auth
 * paths — none at all, which is deliberate.
 */
export function shopOfflineFallbackApplies(
  destination: string,
  pathname: string,
): boolean {
  if (destination !== 'document') return false;
  return !SHOP_FALLBACK_EXCLUDES.some((p) => pathname.startsWith(p));
}
