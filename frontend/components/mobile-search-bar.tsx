'use client';

// MobileSearchBar — sticky search input at the top of every applicable
// page, on phones in both the installed PWA and an ordinary browser tab.
//
// Why both modes: nav.tsx's search unit is `hidden md:flex`, so on a phone
// in browser mode the ONLY search entry point used to be inside the
// hamburger drawer — a first-time visitor never opens it, and the bare
// landing page renders no FilterBar either, so they had no visible way to
// search at all. Finding a specific rifle/scope/tent is the core job of the
// site, so the box has to be on the surface. In standalone mode the top nav
// is hidden entirely (the bottom tab bar replaces it) and this bar IS the
// header.
//
// Self-gates on:
//   * viewport — `md:hidden` in browser mode, because from `md` up the nav
//     already carries the Categories+search unit. In standalone there is no
//     nav at any width, so the bar renders at every width.
//   * a route denylist for focus-flow pages where a sticky search bar
//     would be distracting or have nowhere to go (checkout, /sign-in,
//     /listings/new, KYC, admin chrome, offline fallback).
// Parent pages don't have to think about when to render it: mount once
// in the root layout and the component decides.

import { usePathname } from 'next/navigation';
import { useScrollDirection } from '@/lib/use-scroll-direction';
import { useStandalone } from '@/lib/use-standalone';
import { LiveSearch } from '@/components/live-search';
import { TopWishlistButton } from '@/components/top-wishlist-button';
import { TopCartButton } from '@/components/top-cart-button';
import { isChromelessRoute } from '@/lib/chromeless-routes';

// Pathname prefixes where the sticky search bar should NOT render. All
// of these are either focus flows (checkout / sell / KYC) where search
// noise hurts conversion, or have their own chrome (admin, offline).
const HIDDEN_PREFIXES = [
  '/admin',
  '/checkout',
  '/sign-in',
  '/sign-up',
  '/listings/new',
  '/kyc/verify',
  '/offline',
  '/notifications', // page has its own header; no need for inline search
];

function shouldHide(pathname: string): boolean {
  // ⚠️ AND NOT ON A PAGE THAT IS NOT THE SHOP. This bar is `md:hidden`, so
  // it only ever appeared on phones — which is how a search box, a wishlist
  // heart and a cart ended up across the top of a witness's statutory
  // statement without anybody testing on a desktop ever seeing it.
  if (isChromelessRoute(pathname)) return true;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Dealer-verification upload pages live at /transactions/:id/dealer-verification
  if (pathname.endsWith('/dealer-verification')) return true;
  return false;
}

// Height of nav.tsx's top row (`h-14` = 56px). The nav is `sticky top-0`, so
// in browser mode this bar has to park at exactly that offset — sticking at 0
// would slide it UNDER the nav as soon as the page scrolls. The nav's second
// tier is `hidden md:block`, so it never adds height on the viewports where
// this bar renders.
const NAV_HEIGHT_PX = 56;

export function MobileSearchBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  // ⚠️ BEFORE the early return — hooks cannot sit behind a conditional.
  const scrollDir = useScrollDirection();

  if (shouldHide(pathname)) return null;

  // ── Get out of the way while the user is reading ──────────────────
  //
  // Reported from Chrome on Android: the bar is sticky and "in the way".
  // It was: on a phone the nav pins 56px at the top and this bar pins ~60px
  // directly under it, so ~116px of the screen is permanently chrome — on top
  // of Chrome's own URL bar. Scrolling a category list, most of what you had
  // was header.
  //
  // Same behaviour the bottom tab bar already has (useScrollDirection, hide on
  // down, return on up), so the two pieces of chrome now move as a pair.
  //
  // BROWSER MODE ONLY. In standalone this bar IS the header — the public nav is
  // hidden by CSS — and it also carries the wishlist and cart buttons, so
  // hiding it would leave no top chrome and no way to reach the cart.
  const hideOnScroll = !isStandalone && scrollDir === 'down';

  return (
    <div
      data-chrome-slide
      // In standalone the bar is the header at every width; in browser mode
      // the nav owns search from `md` up, so we only fill the phone gap. A CSS
      // breakpoint (not a JS viewport check) so it's right on the first paint.
      className={isStandalone ? 'app-chrome' : 'app-chrome md:hidden'}
      style={{
        position: 'sticky',
        top: isStandalone ? 0 : NAV_HEIGHT_PX,
        // ⚠️ THE OFFSET IS OWN-HEIGHT *PLUS* THE NAV, not just -100%.
        // Pinned at 56px, translating up by its own height alone lands it
        // roughly on top of the nav — and since we share z-index 50 but come
        // later in the DOM, it would paint OVER the nav on the way past.
        // Clearing NAV_HEIGHT_PX as well parks its bottom edge exactly on the
        // viewport top, so it never overlaps and the z-index can stay put.
        transform: hideOnScroll
          ? `translateY(calc(-100% - ${NAV_HEIGHT_PX}px))`
          : 'translateY(0)',
        // Matches bottom-tab-bar.tsx so the top and bottom chrome move
        // together rather than at two different speeds.
        transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform',
        // Above page content so the LiveSearch dropdown — which renders
        // absolute-positioned inside this container — stacks over the
        // page below it. Deliberately NOT >= 60: the nav's mobile drawer
        // backdrop is z-60 and must be able to dim this bar. The nav itself
        // is also z-50 but never overlaps us geometrically (see NAV_HEIGHT_PX),
        // and we come later in the DOM, so equal z-index is safe.
        zIndex: 50,
        padding: '10px 12px',
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
        // Sit below the iOS status bar in standalone mode (translucent
        // status bar is layered over our content). In a browser tab the
        // browser chrome already owns that strip, so no inset.
        paddingTop: isStandalone
          ? 'calc(10px + env(safe-area-inset-top))'
          : 10,
      }}
    >
      {/* Standalone: search takes the remaining width, with wishlist + cart as
          fixed-size icon buttons beside it. This bar IS the header in the
          installed app, so it carries the two shopping affordances the hidden
          nav used to own. The cart matters most: without an entry point here
          an installed user could add items and then have nowhere to reach
          them — the bottom tab bar has no cart slot (see TopCartButton).
          The buttons are fixed-width and never shrink; only the search input
          gives ground, so both stay tappable down to ~320px viewports.
          Browser mode gets the full width for search instead: the nav row
          right above already carries Sell / bell / cart / menu, and wishlist
          has its entry in the drawer's Account section — duplicating them here
          would only crowd the one control we added this bar for. */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LiveSearch />
        </div>
        {isStandalone && (
          <>
            <TopWishlistButton />
            <TopCartButton />
          </>
        )}
      </div>
    </div>
  );
}
