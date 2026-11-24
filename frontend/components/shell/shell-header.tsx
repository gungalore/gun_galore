'use client';

// The mobile header, in the design's two archetypes.
//
//   ROOT — wordmark, then wishlist / cart / avatar. Home and Account. You
//          arrived here; there is nothing behind you.
//   PUSH — back chevron, then a title. Everything else. You came from
//          somewhere, and back is the affordance.
//
// Home and Search additionally carry a second row holding the search field.
//
// ⚠️ THIS IS NOT STICKY ON MOBILE WEB, AND THAT IS DELIBERATE. See the long
// note on .gg-shell in app/globals.css: a persistent mobile-web search header
// was built three times and rejected three times, most recently as
// "it is sticking to the screen and scrolling with". In a browser the URL bar
// already occupies that band. In the installed app there is no URL bar and this
// header is the only navigation, so there the shell pins it. The difference is
// expressed entirely in CSS; this component renders the same markup either way.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LiveSearch } from '@/components/live-search';
import { useCart } from '@/lib/cart-store';
import { useWishlist } from '@/lib/use-wishlist';
import { pushTitleFor } from '@/lib/shell-routes';
import { ShellStepRow } from '@/components/shell/shell-step';
import { ViewModeToggle } from '@/components/view-mode-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/brand/Logo';

// Routes that get the ROOT header. Everything else gets PUSH.
// `/community` is a main screen, not a pushed detail. It keeps the ROOT header
// (logo, three-way switch, cart) and the search row so the member can still
// search and switch surfaces from the feed (operator, 2026-11-24).
const ROOT_PATHS = new Set(['/', '/account', '/community']);

// Routes that carry the search row under the header.
function hasSearchRow(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/community' ||
    pathname.startsWith('/category/')
  );
}

const STROKE = {
  fill: 'none',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconHeart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" stroke="var(--text-secondary)" {...STROKE} aria-hidden>
      <path d="M12 20.3 C7 15.9 3.5 12.9 3.5 9.3 A4.3 4.3 0 0 1 12 6.6 4.3 4.3 0 0 1 20.5 9.3 C20.5 12.9 17 15.9 12 20.3 Z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" stroke="var(--text-secondary)" {...STROKE} aria-hidden>
      <circle cx="9.5" cy="20" r="1.5" />
      <circle cx="17.5" cy="20" r="1.5" />
      <path d="M3 4 H5.5 L7.7 15 A1.6 1.6 0 0 0 9.3 16.3 H17.8 A1.6 1.6 0 0 0 19.4 15 L21 8 H6.3" />
    </svg>
  );
}

function IconBack() {
  return (
    // ⚠️ Heavier than every other icon here — stroke 2 and primary ink, where
    // the rest are 1.8 and secondary. That is the design's own weighting,
    // consistent across all seven of its push boards, not a slip: back is the
    // primary affordance on a screen that has no other navigation.
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--text-primary)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 5 8 12 15 19" />
    </svg>
  );
}

/** 44x44 tap target — the minimum the accessibility guidance asks for, and the
 *  size the design draws. The icon inside is 22px; the rest is touch slop. */
function TapTarget({
  children,
  badge,
  ...rest
}: {
  children: React.ReactNode;
  badge?: number;
} & React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className="gg-press"
      style={{
        position: 'relative',
        width: 44,
        height: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            // Neutral count badge: the action accent belongs to Sell only.
            background: 'var(--text-primary)',
            color: 'var(--bg-deep)',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

/** Cart icon + badge, shared by both header archetypes — ROOT's own slot and
 *  PUSH's trailing slot (every push route now carries it; see PushHeader). */
function CartLink() {
  const items = useCart();
  const cartCount = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);
  return (
    <TapTarget
      href="/cart"
      aria-label={cartCount === 0 ? 'Cart, empty' : `Cart, ${cartCount} items`}
      badge={cartCount}
    >
      <IconCart />
    </TapTarget>
  );
}

function RootHeader() {
  const { count: savedCount } = useWishlist();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px 0 16px',
        height: '100%',
      }}
    >
      {/* ⚠️ EMBLEM ONLY (operator, 2026-11-23). Dropping the wordmark buys
          the width the three-way Marketplace/Auction/Community switch needs in
          the 54px root row. The accessible name is still "ALL Outdoor". */}
      <Link
        href="/"
        aria-label="ALL Outdoor"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        <Logo variant="emblem" height={30} priority />
      </Link>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
        {/* Marketplace/Auction/Community — the always-on view switch (PWA). */}
        <ViewModeToggle size="sm" />
        {/* ⚠️ THE WISHLIST HEART IS THE ONE CONTROL THAT GIVES WAY ON A NARROW
            PHONE, AND IT IS WRAPPED SO CSS CAN DROP IT. The row is emblem
            (~53) + three-way switch (191) + heart + cart (44 each) + padding —
            roughly 356px once the heart is in, 312px once it is dropped. A
            360px Android phone still fits the heart-less row; the overflow the
            400px rule prevents is the LAYOUT viewport expanding above the media
            query, which used to push the fixed tab bar below the visible
            screen. The heart is duplicated in the More sheet and the account
            menu, so it is the cheapest thing to lose on a small screen. See the
            .gg-header-wishlist rule in globals.css. */}
        <span className="gg-header-wishlist" style={{ display: 'contents' }}>
          <TapTarget href="/wishlist" aria-label={`Wishlist, ${savedCount} saved`} badge={savedCount}>
            <IconHeart />
          </TapTarget>
        </span>
        <CartLink />
        {/* ⚠️ NO AVATAR HERE (operator, 2026-11-24). The bottom tab bar owns
            Account on every root screen, including /community, so a second
            account target in the top-right was redundant. */}
      </span>
    </div>
  );
}

function PushHeader({ pathname }: { pathname: string }) {
  const router = useRouter();
  const mapped = pushTitleFor(pathname);
  const [title, setTitle] = useState<string | null>(mapped);

  // Where the route table has no entry — a listing, a seller profile — the page
  // has already told the browser its name through Next's metadata. Taking the
  // first segment of document.title turns "Blue bait — ALL Outdoor — All
  // Outdoor" into "Blue bait" without every page having to push a title into a
  // context. Runs after paint, so the mapped value (or nothing) renders first.
  useEffect(() => {
    if (mapped) {
      setTitle(mapped);
      return;
    }
    const derived = document.title.split('—')[0]?.trim();
    setTitle(derived && derived.length > 0 ? derived : null);
  }, [mapped, pathname]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        height: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => {
          // Notifications always goes to Account, even when the PWA has a
          // history entry (which is every launch on iOS). The Back chevron is
          // an exit from the notification centre, not a history scrubber.
          // replace() rather than push() so pressing system back afterwards
          // does not drop the member straight back into Notifications.
          if (pathname.startsWith('/notifications')) {
            router.replace('/account');
            return;
          }
          // Everywhere else, history.back() returns the member to their
          // filters and scroll position; a cold entry from a shared link has
          // no history and goes Home.
          if (window.history.length > 1) router.back();
          else router.push('/');
        }}
        aria-label="Back"
        className="gg-press"
        style={{
          width: 44,
          height: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <IconBack />
      </button>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 16,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </span>
      {/* ⚠️ NO VIEW SWITCH ON A PUSH SCREEN. The three-way control needs ~186px
          at size="sm"; with back + title + theme + cart there is nothing left
          for the title on a 360px phone, even at a two-way 141px. A push screen
          is a task with a back button, not a place to change section; the root
          header and the desktop nav carry the switch. */}
      {/* Theme — the ROOT header has no room for this (the switch, wishlist,
          cart and avatar already fill it), so a push screen carries the icon
          and /account carries the labelled three-way control. */}
      <ThemeToggle />
      {/* Trailing slot — cart on every push route now (board review,
          2026-08-27), reusing CartLink from the ROOT header so the icon,
          badge and count logic can't drift between the two archetypes. The
          design draws share alongside it on a listing board, but share is
          per-page (it needs that page's own title/url/image) and belongs
          with the listing, not hardcoded into the shell. */}
      <CartLink />
    </div>
  );
}

function SearchRow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <LiveSearch />
      </div>
      {/* Categories are a shop destination, not a second search field. The
          button asks the bottom tab bar's existing category-first sheet to
          open; that sheet owns the fetch and the member/anon cache, so this
          adds no request and no new route. The row is only rendered on "/"
          and "/category/*", both of which carry the tab bar. */}
      <button
        type="button"
        aria-label="Shop by category"
        title="Shop by category"
        onClick={() => {
          window.dispatchEvent(new Event('gg:open-shop-sheet'));
        }}
        className="gg-press"
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: 'var(--bg-inset)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
        </svg>
      </button>
    </div>
  );
}

export function ShellHeader() {
  const pathname = usePathname() ?? '/';
  const isRoot = ROOT_PATHS.has(pathname);

  // ⚠️ DELIBERATELY NOT useSearchParams(). Reading it here put this whole
  // header behind the Suspense boundary in app-shell.tsx, and on a statically
  // rendered route that means the prerendered HTML ships with NO HEADER — it
  // pops in after hydration, shoving the page down. Measured on /deals: absent
  // at 3.5s, present at 4s.
  //
  // It was also redundant. The only query that mattered was `q`, and a results
  // view is `/?q=…` — pathname `/`, which hasSearchRow already matches. There
  // is no route that carries q and is not a shopping surface.
  const showSearch = hasSearchRow(pathname);

  return (
    <header data-shell-header className="gg-shell-chrome" style={{ flexDirection: 'column' }}>
      <div
        style={{
          height: 'var(--shell-header-h)',
          background: 'var(--bg-card)',
          // ⚠️ THE BACKGROUND STOPS AT THE CONTENT BOX, SO THE STATUS-BAR STRIP
          // IS THE PAGE COLOUR, NOT THE HEADER COLOUR.
          //
          // In the installed app the padding above this row is exactly the
          // notch/status-bar band, and iOS paints the clock and battery over it
          // in a tint taken from theme_color — which is --bg (the page cream),
          // not --bg-card (white). Painting --bg-card through the padding, as
          // this did, gave every launched app a white band with a cream
          // status-bar tint on top of it: a seam at the top of every screen on
          // the one surface where nothing may look misaligned.
          //
          // content-box means the 54px row keeps its white fill and the inset
          // band above it is transparent, showing .gg-shell's --bg behind it —
          // the same colour iOS is painting the status bar with.
          backgroundClip: 'content-box',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          // In the installed app the translucent status bar is layered over the
          // page, so the chrome row has to start below it. box-sizing is
          // border-box globally (Tailwind preflight), so the inset adds to the
          // 54px rather than eating into it.
          paddingTop: 'env(safe-area-inset-top)',
          boxSizing: 'content-box',
        }}
      >
        {isRoot ? <RootHeader /> : <PushHeader pathname={pathname} />}
      </div>
      {showSearch && <SearchRow />}
      {/* Row two on a wizard. Renders only when the page below has published a
          step (see shell-step.tsx), so every other screen pays nothing. */}
      {!isRoot && <ShellStepRow />}
    </header>
  );
}
