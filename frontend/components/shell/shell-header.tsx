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
import { useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { LiveSearch } from '@/components/live-search';
import { useCart } from '@/lib/cart-store';
import { useWishlist } from '@/lib/use-wishlist';
import { pushTitleFor } from '@/lib/shell-routes';
import { ShellStepRow } from '@/components/shell/shell-step';

// Routes that get the ROOT header. Everything else gets PUSH.
const ROOT_PATHS = new Set(['/', '/account']);

// Routes that carry the search row under the header.
function hasSearchRow(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/category/');
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
            background: 'var(--red)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-display), Archivo, sans-serif',
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

function Avatar() {
  const { user, isSignedIn } = useUser();

  // ⚠️ The design draws this circle in one state only — signed in, showing
  // initials. It specifies nothing for signed-out or still-loading. Rather than
  // invent a second visual, both fall back to the same circle with a neutral
  // person glyph, and the destination does the work: /account bounces a
  // signed-out visitor to sign-in, which is the only sign-in entry point on
  // mobile now that the drawer is gone.
  const initials =
    (isSignedIn &&
      (user?.username?.charAt(0) ??
        user?.firstName?.charAt(0) ??
        user?.primaryEmailAddress?.emailAddress?.charAt(0))) ||
    null;

  return (
    <TapTarget href="/account" aria-label={isSignedIn ? 'Your account' : 'Sign in'}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background: 'var(--bg-inset)',
          border: '1px solid var(--border-hover)',
          color: 'var(--text-tertiary)',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          textTransform: 'uppercase',
        }}
      >
        {initials ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" {...STROKE} aria-hidden>
            <circle cx="12" cy="8.5" r="3.8" />
            <path d="M4.5 20.5 C5.5 16.7 8.5 14.8 12 14.8 C15.5 14.8 18.5 16.7 19.5 20.5" />
          </svg>
        )}
      </span>
    </TapTarget>
  );
}

function RootHeader() {
  const items = useCart();
  const { count: savedCount } = useWishlist();
  const cartCount = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);

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
      <Link
        href="/"
        style={{
          fontFamily: 'var(--font-display), Archivo, sans-serif',
          fontWeight: 800,
          fontSize: 17,
          letterSpacing: '-0.3px',
          whiteSpace: 'nowrap',
          color: 'var(--text-primary)',
          textDecoration: 'none',
        }}
      >
        ALL <span style={{ color: 'var(--red)' }}>OUTDOOR</span>
      </Link>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
        <TapTarget href="/wishlist" aria-label={`Wishlist, ${savedCount} saved`} badge={savedCount}>
          <IconHeart />
        </TapTarget>
        <TapTarget
          href="/cart"
          aria-label={cartCount === 0 ? 'Cart, empty' : `Cart, ${cartCount} items`}
          badge={cartCount}
        >
          <IconCart />
        </TapTarget>
        <Avatar />
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
  // first segment of document.title turns "Blue bait — All Outdoor — All
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
          // history.back() where there is history, so the member returns to
          // their filters and scroll position rather than being dropped on the
          // home page. A cold entry from a shared link has none.
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
          fontFamily: 'var(--font-display), Archivo, sans-serif',
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
      {/* The design leaves this slot filled differently on each push board —
          share + cart on a listing, search on Orders, and genuinely empty on
          Cart, Checkout, Sell and both Centres. Empty is the honest default;
          per-board fills belong with those pages, not in the shell. */}
      <span style={{ display: 'flex', alignItems: 'center' }} />
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
