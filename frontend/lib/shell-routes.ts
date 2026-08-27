// Which mobile routes get which shell chrome.
//
// The design pack draws two mobile header archetypes and only ever puts the
// five-tab bar on the shopping surfaces:
//
//   ROOT  — wordmark + wishlist + cart + avatar, and the tab bar underneath.
//           Home, Account. These are destinations you arrive at, not pages you
//           came from, so there is nothing to go back to.
//   PUSH  — back chevron + title. Cart, Checkout, Sell, a listing, the two
//           Centres, Orders detail. You got here from somewhere; back is the
//           affordance, and a shopping tab bar under a checkout is noise.
//
// ⚠️ THE TAB BAR IS AN ALLOWLIST, NOT A DENYLIST, AND THAT IS THE POINT.
// It used to be gated on one thing — `if (!isStandalone) return null` — with no
// route awareness at all. That put a five-tab shopping bar across /witness and
// /consent for every installed user: statutory statements that
// lib/chromeless-routes.ts exists specifically to keep marketplace chrome off.
// A denylist would have to remember every such page forever; an allowlist is
// wrong only in the safe direction (a missing tab bar, never a shopping bar
// over a legal notice).

import { isChromelessRoute } from '@/lib/chromeless-routes';

/** Exact paths that carry the tab bar. */
const TAB_EXACT = new Set(['/', '/wishlist', '/my/orders', '/account']);

/** Prefixes whose subtree carries the tab bar. */
const TAB_PREFIXES = ['/category/', '/orders/'];

/**
 * Routes that own their whole screen and must get NO shell at all — not the
 * header, not the tab bar. Admin has its own chrome; the Clerk pages and the
 * offline fallback are standalone screens.
 */
const NO_SHELL_PREFIXES = ['/admin', '/sign-in', '/sign-up', '/offline'];

/** True when this route should render the five-tab bottom bar. */
export function isTabRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (!hasShell(pathname)) return false;
  if (TAB_EXACT.has(pathname)) return true;
  return TAB_PREFIXES.some((p) => pathname.startsWith(p));
}

/** True when this route gets the mobile shell chrome at all. */
export function hasShell(pathname: string | null): boolean {
  if (!pathname) return false;
  if (isChromelessRoute(pathname)) return false;
  if (NO_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }
  // Dealer-verification uploads are a focus flow reached from an SMS link.
  if (pathname.endsWith('/dealer-verification')) return false;
  return true;
}

/**
 * Titles for the push header, longest-prefix-wins.
 *
 * Only routes whose title cannot be derived need an entry. Everything else
 * falls back to the document title's first segment, which Next's metadata
 * already sets per page ("Blue bait — All Outdoor — All Outdoor" → "Blue
 * bait") — that is how a listing's own name reaches the header without every
 * page having to push a title into a context.
 */
const PUSH_TITLES: Array<[string, string]> = [
  ['/listings/new', 'Sell an item'],
  ['/checkout', 'Checkout'],
  ['/cart', 'Cart'],
  ['/documents', 'Document Centre'],
  ['/motivations', 'Motivation Centre'],
  ['/load-lab', 'Load Lab'],
  ['/licence-centre', 'Licence Centre'],
  ['/notifications', 'Notifications'],
  ['/my/offers', 'Offers'],
  ['/my/bids', 'Bids'],
  ['/my/listings', 'My listings'],
  ['/my/sales', 'Sales'],
  ['/my/earnings', 'Earnings'],
  ['/saved-searches', 'Saved searches'],
  ['/shipping', 'Deliveries'],
  ['/profile', 'Profile'],
  ['/settings', 'Settings'],
  ['/dashboard', 'Seller dashboard'],
  ['/support', 'Support'],
  ['/faq', 'FAQ'],
  ['/deals', 'Daily Deals'],
  ['/kyc', 'Verification'],
  ['/scan', 'Scan'],
];

/** The push header's title for a route, or null to show the back button alone. */
export function pushTitleFor(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const [prefix, title] of PUSH_TITLES) {
    if (
      (pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
      prefix.length > bestLen
    ) {
      best = title;
      bestLen = prefix.length;
    }
  }
  return best;
}
