'use client';

// MobileSearchBar — THE INSTALLED APP'S HEADER. Standalone PWA only.
//
// In standalone mode globals.css hides the whole top nav
// (`html[data-standalone='true'] [data-public-nav] { display: none }`), so
// this bar is the only chrome above the page. It carries three things: the
// search input, the wishlist heart and the cart. The cart is the
// load-bearing one — the bottom tab bar has Shop / Alerts / Sell / Ask Boet /
// More and no cart slot, so without this bar an installed user could add
// items and then have no way to reach them (see TopCartButton).
//
// ⚠️ DO NOT RENDER THIS IN A BROWSER TAB — AND DO NOT PUT IT BACK.
// It used to render on mobile web too (`md:hidden`), because nav.tsx's
// search unit is `hidden md:flex` and a phone visitor's only search entry
// point was buried in the hamburger drawer. The browser-mode version was
// tried three ways and the operator rejected all three:
//   1. sticky under the nav at top:56px — "it is sticking to the screen and
//      scrolling with", i.e. permanently occupying the viewport;
//   2. hide-on-scroll — momentum scrolling flips direction constantly on a
//      touch device, so it flickered in and out under the reader's thumb;
//      reverted the same day;
//   3. permanently sticky again — still unwanted on screen at all.
// Mobile web now gets a search ICON in nav.tsx beside the Sell button, which
// opens search on demand and costs zero vertical space. Operator, 2026-08-22:
// "Get rid of the search bar and just add a search icon next the sell button
// on the mobile webpage only." If mobile-web search needs work, fix that
// icon — do not add a browser-mode branch back here.
//
// Self-gates on:
//   * display mode — useStandalone(), NOT a CSS breakpoint. In standalone
//     there is no nav at any width, so the bar renders at every width and a
//     breakpoint cannot express the rule. (The nav's own `md:hidden`-style
//     gating is irrelevant here now that browser mode renders nothing.)
//     ⚠️ useStandalone is false on the server and for the hydration render,
//     so in the installed app the bar mounts one frame after hydration and
//     the page below shifts down. That is the safe direction — a browser tab
//     never flashes a bar the operator asked us to remove. If the shift ever
//     needs killing, gate on `html[data-standalone='true']` (set pre-paint by
//     the inline script in app/layout.tsx) rather than reviving a breakpoint.
//   * a route denylist for focus-flow pages where a sticky search bar
//     would be distracting or have nowhere to go (checkout, /sign-in,
//     /listings/new, KYC, admin chrome, offline fallback).
// Parent pages don't have to think about when to render it: mount once
// in the root layout and the component decides.

import { usePathname } from 'next/navigation';
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
  // ⚠️ AND NOT ON A PAGE THAT IS NOT THE SHOP. This bar only ever rendered on
  // phones — which is how a search box, a wishlist heart and a cart ended up
  // across the top of a witness's statutory statement without anybody testing
  // on a desktop ever seeing it. Now that the bar is standalone-only the
  // audience is narrower still, and just as invisible to desktop testing.
  if (isChromelessRoute(pathname)) return true;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Dealer-verification upload pages live at /transactions/:id/dealer-verification
  if (pathname.endsWith('/dealer-verification')) return true;
  return false;
}

export function MobileSearchBar() {
  // Both hooks run unconditionally, before any early return — React requires
  // a stable hook order across renders, and useStandalone flips value after
  // hydration, so a return placed above it would change that order.
  const isStandalone = useStandalone();
  const pathname = usePathname();

  // Installed app only. See the header note: mobile web gets a search icon in
  // the nav instead, and the nav is what's hidden in standalone.
  if (!isStandalone) return null;
  if (shouldHide(pathname)) return null;

  return (
    <div
      className="app-chrome"
      style={{
        position: 'sticky',
        // No nav above us in standalone — the bar parks at the very top and
        // IS the header.
        top: 0,
        // ⚠️ IT STAYS PUT. DO NOT ADD HIDE-ON-SCROLL.
        //
        // This bar was briefly given the bottom tab bar's scroll-direction
        // behaviour — slide away on scroll-down, return on scroll-up. It was
        // reverted the same day. On a touch device, momentum scrolling flips
        // direction constantly, so the bar flickered in and out of view while
        // the user was just reading a list. A control that appears and
        // disappears under your thumb is worse than one that simply occupies
        // its space. That matters more here than it ever did on mobile web:
        // in the installed app this is the ONLY route to the cart.
        //
        // Pure CSS sticky, no JS, nothing to jitter. If the chrome ever needs
        // to be slimmer, take the height out of it — do not make it move.
        // Above page content so the LiveSearch dropdown — which renders
        // absolute-positioned inside this container — stacks over the
        // page below it. Deliberately NOT >= 60: modals and sheets live at
        // z >= 60 and must be able to cover this bar. The bottom tab bar is
        // z-55 and never overlaps us geometrically.
        zIndex: 50,
        padding: '10px 12px',
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
        // Sit below the iOS status bar: in standalone the translucent status
        // bar is layered over our content, so the inset is always needed.
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
      }}
    >
      {/* Search takes the remaining width, with wishlist + cart as fixed-size
          icon buttons beside it. This bar IS the header in the installed app,
          so it carries the two shopping affordances the hidden nav used to
          own. The cart matters most: without an entry point here an installed
          user could add items and then have nowhere to reach them — the
          bottom tab bar has no cart slot (see TopCartButton).
          The buttons are fixed-width and never shrink; only the search input
          gives ground, so both stay tappable down to ~320px viewports. */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LiveSearch />
        </div>
        <TopWishlistButton />
        <TopCartButton />
      </div>
    </div>
  );
}
