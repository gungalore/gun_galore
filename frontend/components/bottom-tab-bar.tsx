'use client';

// Bottom tab bar — the primary nav for installed-PWA users.
//
// Replaces the top hamburger nav (which gets hidden via CSS when
// html[data-standalone="true"]) so the installed app reads as
// native-iOS rather than "website opened fullscreen".
//
// Rendered always in the layout but the component is a no-op (returns
// null) when not in standalone mode. That keeps server HTML identical
// for browser-mobile users — they continue using the existing
// hamburger drawer in nav.tsx.
//
// Five tabs — Sell sits dead-centre (position 3) so the raised FAB
// styling reads symmetric:
//   1. Shop     → opens a bottom sheet with 5 shopping surfaces:
//                 All listings / Marketplace / Auctions / Take a Shot /
//                 Competitions.
//   2. Alerts   → routes to /notifications. Bell icon. When there are
//                 unresolved notifications, shows a red active-count
//                 badge in the top-right corner of the bell.
//   3. Sell     → /listings/new (centred, raised red FAB — the
//                 prominent primary action).
//   4. Ask GG   → /ask-gg. Sparkles icon. Paid AI assistant — answers
//                 firearm / shooting / SA gun-law questions, identifies
//                 firearms from photos (Phase B), helps with checkout
//                 and reloading. FREE tier sees an upgrade card; MEMBER
//                 and PRO tiers get the live chat. Topic-gated at the
//                 system-prompt level so it won't entertain off-topic
//                 questions. (Wishlist used to live in this slot — it
//                 moved to the 25% button next to the search bar at
//                 the top of the PWA. See TopWishlistButton.)
//   5. More     → bottom sheet headed by the user's avatar + username,
//                 followed by My account / Shop / Legal sections.
//                 All `/my/*` destinations + /dashboard + /profile
//                 live in here, plus a Wishlist fallback link under
//                 Shop for routes where the top search bar is hidden.
//
// Active-route highlighting via usePathname() + a search-aware match
// helper (so /?listingType=AUCTION lights up the Shop tab even
// though the pathname is just '/').

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SignInButton, useUser, useClerk, useAuth } from '@clerk/nextjs';
import { useStandalone } from '@/lib/use-standalone';
import { useScrollDirection } from '@/lib/use-scroll-direction';
import { PushToggleRow } from '@/components/push-opt-in-banner';
import { AccountMenuList } from '@/lib/account-menu';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Tab {
  key: string;
  label: string;
  href: string;
  // Returns true when the active route belongs to this tab.
  isActive: (pathname: string, search: URLSearchParams) => boolean;
  // Centred-prominent tabs (currently just Sell) get the raised
  // circular-FAB treatment. Only works at 5 tabs (position 3 = 50%).
  prominent?: boolean;
  // 'shop' / 'more' open sheets instead of navigating.
  action?: 'shop' | 'more';
}

// Inline SVG icons — no extra dep. 24×24 viewbox, currentColor stroke
// so the active state can tint via `color: var(--red)`.
function IconShop() {
  // Shopping-bag silhouette — universal "browse / shop" affordance.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 8V6a3 3 0 0 1 6 0v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconGavel() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4l6 6m-3-3l-7 7m-4-4l5 5m-5-5l-3 3 4 4 3-3m9-13l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 20h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconCart() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 5h2l2.5 11a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.5L21 9H7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H5a2 2 0 0 0 2 2m10-2h2a2 2 0 0 1-2 2M10 16h4l1 4H9l1-4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconMore() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 14V9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconSparkles() {
  // Four-point sparkle cluster — universal "AI / magic" affordance.
  // A large centre sparkle with two smaller satellite sparkles reads
  // as the "smart helper" idiom established by ChatGPT / Apple
  // Intelligence / Copilot. Drawn with currentColor stroke so the
  // active-tab tint (var(--red)) flows through.
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Main sparkle — centred, larger */}
      <path
        d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Small sparkle — top-right */}
      <path
        d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Small sparkle — bottom-right */}
      <path
        d="M18.5 16 L19 17.2 L20.2 17.7 L19 18.2 L18.5 19.4 L18 18.2 L16.8 17.7 L18 17.2 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BottomTabBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const scrollDir = useScrollDirection();
  const [shopOpen, setShopOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [alertsCount, setAlertsCount] = useState<number>(0);

  // Hide the tab bar when the user is scrolling DOWN (give them more
  // reading room) and re-show when they scroll back up — standard
  // native-iOS app pattern (Safari does this with its tab bar too).
  // Always show when a sheet is open so the bar doesn't disappear
  // mid-interaction. `data-bottom-chrome-hidden` is mirrored onto
  // <body> so the sticky featured strip can hide in sync.
  const sheetOpen = shopOpen || moreOpen;
  const hideChrome = scrollDir === 'down' && !sheetOpen;

  useEffect(() => {
    if (hideChrome) {
      document.body.dataset.bottomChromeHidden = 'true';
    } else {
      delete document.body.dataset.bottomChromeHidden;
    }
  }, [hideChrome]);

  // Auto-close any open sheet on route change (mirrors the mobile-drawer
  // behaviour in nav.tsx).
  useEffect(() => {
    setShopOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Body-scroll lock while any sheet is open.
  useEffect(() => {
    if (shopOpen || moreOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [shopOpen, moreOpen]);

  // Active-count poll for the bell badge. Cheap COUNT query on the
  // server. Resilient: silently no-ops if the endpoint isn't deployed
  // yet (Drop 1 ships the UI before the backend; badge stays at 0
  // until the migration + controller land). Also refreshes when the
  // user navigates (covers the case where they just took an action).
  useEffect(() => {
    if (!isStandalone || !isSignedIn) {
      setAlertsCount(0);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`${API_URL}/notifications/me/active-count`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return; // endpoint not deployed yet → silent no-op
        const data = (await r.json()) as { total?: number };
        if (!cancelled) setAlertsCount(data.total ?? 0);
      } catch {
        // Network blip — keep last known count.
      }
    }
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isStandalone, isSignedIn, getToken, pathname]);

  // Server HTML stays identical to browser-mobile — the tab bar only
  // exists for installed PWA users. The CSS rule that pads the body
  // (`html[data-standalone='true'] body { padding-bottom: ... }`)
  // still applies regardless so the layout is consistent.
  if (!isStandalone) return null;

  // "Shop" tab is active on any of the 4 shopping surfaces + the
  // competitions route (i.e. anywhere the picker would point to).
  const isShopSurface =
    pathname === '/' || pathname.startsWith('/competitions');

  const tabs: Tab[] = [
    {
      key: 'shop',
      label: 'Shop',
      href: '#shop',
      isActive: () => shopOpen || isShopSurface,
      action: 'shop',
    },
    {
      key: 'alerts',
      label: 'Alerts',
      href: '/notifications',
      isActive: (p) => p.startsWith('/notifications'),
      // No `action` — this is a real Link, not a sheet.
    },
    {
      key: 'sell',
      label: 'Sell',
      href: '/listings/new',
      isActive: (p) => p.startsWith('/listings/new'),
      prominent: true,
    },
    {
      key: 'ask-gg',
      label: 'Ask GG',
      // Paid AI assistant. Page itself is open (no auth gate at the
      // route level) so signed-out users see the marketing/upgrade
      // surface; FREE tier sees an upgrade card; MEMBER + PRO get
      // the live chat.
      href: '/ask-gg',
      isActive: (p) => p.startsWith('/ask-gg'),
    },
    {
      key: 'more',
      label: 'More',
      href: '#more',
      isActive: () => moreOpen,
      action: 'more',
    },
  ];

  function renderIcon(key: string) {
    switch (key) {
      case 'shop':
        return <IconShop />;
      case 'alerts':
        // Bell + an optional unread-count badge in the top-right corner.
        // Badge only renders when alertsCount > 0 — the clear "you have
        // unfinished business" indicator that polls via active-count
        // and only drops when the user ACTS on the underlying entity
        // (server-side auto-resolve), NOT when they open the inbox.
        return (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconBell />
            {alertsCount > 0 && (
              <span
                aria-label={`${alertsCount} unresolved`}
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--red)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  // Crisp ring around the badge so it pops off the
                  // dark tab-bar background.
                  border: '1.5px solid var(--bg-deep)',
                }}
              >
                {alertsCount > 9 ? '9+' : alertsCount}
              </span>
            )}
          </span>
        );
      case 'sell':
        return <IconPlus />;
      case 'ask-gg':
        // Sparkles icon — universal "AI / smart helper" affordance.
        // Drop 1 ships no badge; future drops can surface "N messages
        // left this month" for FREE users (their 5-msg cap).
        return <IconSparkles />;
      case 'more':
        return <IconMore />;
      default:
        return null;
    }
  }

  return (
    <>
      <nav
        className="app-chrome"
        aria-label="Primary"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 55,
          background: 'var(--bg-deep)',
          borderTop: '0.5px solid var(--border)',
          // Pad below the home indicator so the tappable row sits above it.
          paddingBottom: 'env(safe-area-inset-bottom)',
          // Auto-hide on downward scroll. translateY by 100% + the
          // safe-area inset so it slides fully off-screen including
          // the padding below the home indicator.
          transform: hideChrome
            ? 'translateY(calc(100% + env(safe-area-inset-bottom)))'
            : 'translateY(0)',
          transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
      >
        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            height: 60,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.isActive(pathname, searchParams);
            const color = active
              ? 'var(--red)'
              : tab.prominent
                ? 'var(--text-primary)'
                : 'var(--text-tertiary)';

            const inner = (
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  height: '100%',
                  color,
                  fontSize: 10.5,
                  fontWeight: active ? 600 : 500,
                  letterSpacing: 0.1,
                  textDecoration: 'none',
                }}
              >
                {tab.prominent ? (
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'var(--red)',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: -8,
                      // Raised effect — gives the central primary action visual weight.
                      boxShadow: '0 4px 12px rgba(200, 16, 46, 0.4)',
                    }}
                  >
                    {renderIcon(tab.key)}
                  </span>
                ) : (
                  renderIcon(tab.key)
                )}
                <span>{tab.label}</span>
              </span>
            );

            return (
              <li key={tab.key} style={{ height: '100%' }}>
                {tab.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (tab.action === 'shop') setShopOpen(true);
                      else if (tab.action === 'more') setMoreOpen(true);
                    }}
                    aria-label={tab.label}
                    aria-expanded={
                      tab.action === 'shop' ? shopOpen : moreOpen
                    }
                    style={{
                      width: '100%',
                      height: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={tab.href}
                    aria-label={tab.label}
                    style={{
                      display: 'block',
                      height: '100%',
                      textDecoration: 'none',
                    }}
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {shopOpen && (
        <ShopSheet
          pathname={pathname}
          searchParams={searchParams}
          onClose={() => setShopOpen(false)}
        />
      )}

      {moreOpen && (
        <MoreSheet
          isSignedIn={!!isSignedIn}
          username={user?.username ?? user?.firstName ?? null}
          email={user?.primaryEmailAddress?.emailAddress ?? null}
          imageUrl={user?.imageUrl ?? null}
          onClose={() => setMoreOpen(false)}
          onSignOut={() => {
            void signOut(() => {
              setMoreOpen(false);
            });
          }}
        />
      )}
    </>
  );
}

// (SearchSheet removed — search now lives as the sticky MobileSearchBar
// at the top of every applicable page in standalone mode.)

// ─── Shop sheet — picker for the 5 shopping surfaces ──────────────
// Replaces the old separate Browse + Auctions tabs with one entry
// point that surfaces all four shopping modes (plus the unfiltered
// "All listings" view) with equal weight. Patterned after the App
// Store's "Today / Games / Apps / ..." section selector.
function ShopSheet({
  pathname,
  searchParams,
  onClose,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  onClose: () => void;
}) {
  // Source of truth for the picker. Order = how prominent we want
  // each surface to be. Taglines mirror those in app/page.tsx
  // (SURFACE_TITLES) so the picker and the destination header speak
  // the same language.
  const surfaces: Array<{
    key: string;
    href: string;
    title: string;
    tagline: string;
    icon: React.ReactNode;
    isActive: boolean;
  }> = [
    {
      key: 'all',
      // Explicit sort=newest disables the curated Featured-landing on
      // page.tsx (showHero condition excludes when sort is set) so the
      // user lands on the actual all-listings grid sorted latest-first.
      // The grid mounts a SortToggle that lets them flip to price_asc.
      href: '/?sort=newest',
      title: 'All listings',
      tagline: 'Everything on sale right now, across every surface',
      icon: <IconList />,
      isActive:
        pathname === '/' &&
        !searchParams.get('listingType') &&
        !!searchParams.get('sort'),
    },
    {
      key: 'marketplace',
      href: '/?listingType=BUY_NOW',
      title: 'Marketplace',
      tagline: 'Used firearms and gear — pay the listed price and go',
      icon: <IconCart />,
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'BUY_NOW',
    },
    {
      key: 'auctions',
      href: '/?listingType=AUCTION',
      title: 'Auctions',
      tagline: 'Timed bidding with proxy bids and snipe protection',
      icon: <IconGavel />,
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'AUCTION',
    },
    {
      key: 'takeashot',
      href: '/?listingType=TAKE_A_SHOT',
      title: 'Take a Shot',
      tagline: 'Make an offer — sellers can accept, counter once, or decline',
      icon: <IconTarget />,
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'TAKE_A_SHOT',
    },
    {
      key: 'swop',
      href: '/?listingType=SWOP',
      title: 'Swop / Trade',
      tagline: 'Trade your gear for someone else’s — add cash if needed',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 4 3 8l4 4" />
          <path d="M3 8h13" />
          <path d="m17 20 4-4-4-4" />
          <path d="M21 16H8" />
        </svg>
      ),
      isActive:
        pathname === '/' && searchParams.get('listingType') === 'SWOP',
    },
    {
      key: 'competitions',
      href: '/competitions',
      title: 'Competitions',
      tagline: 'Win prizes via raffle tickets — paid or free postal entry',
      icon: <IconTrophy />,
      isActive: pathname.startsWith('/competitions'),
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 56,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Shop"
        aria-modal="true"
        style={{
          width: '100%',
          maxHeight: '85dvh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          borderTop: '0.5px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingTop: 6,
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          animation: 'gg-sheet-up 240ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 44,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-hover)',
            margin: '8px auto 8px',
          }}
        />
        <p
          style={{
            padding: '4px 20px 12px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            margin: 0,
          }}
        >
          Choose a surface
        </p>

        <ul style={{ listStyle: 'none', margin: 0, padding: '0 12px' }}>
          {surfaces.map((s) => (
            <li key={s.key} style={{ marginBottom: 6 }}>
              <Link
                href={s.href}
                onClick={onClose}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: s.isActive
                    ? 'rgba(200, 16, 46, 0.10)'
                    : 'var(--bg-inset)',
                  border: `0.5px solid ${
                    s.isActive ? 'rgba(200, 16, 46, 0.40)' : 'var(--border)'
                  }`,
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: s.isActive
                      ? 'rgba(200, 16, 46, 0.20)'
                      : 'var(--bg-card)',
                    color: s.isActive
                      ? 'var(--red)'
                      : 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {s.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 15,
                      fontWeight: 600,
                      color: s.isActive
                        ? 'var(--red)'
                        : 'var(--text-primary)',
                      marginBottom: 2,
                    }}
                  >
                    {s.title}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {s.tagline}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Bottom-sheet drawer for secondary destinations ────────────────
//
// Top-to-bottom layout:
//   1. Drag-handle pill (visual cue)
//   2. Profile header card — avatar + username + tier → tap opens
//      /profile. For signed-out users this collapses to a Sign-in
//      pill instead.
//   3. My account section — Dashboard, Profile, all /my/* destinations.
//      Folded into the sheet because the "My" tab was replaced by
//      Wishlist; the My destinations still need a permanent home.
//   4. Shop section — secondary shop surfaces (Take a Shot, Competitions).
//      Wishlist is intentionally NOT here because it's a primary tab.
//   5. Legal section — terms / privacy / refund / legal index.
//   6. Sign out (signed-in only) — destructive-styled button below.
//
// Visual notes:
//   - Trailing chevron on every nav row so they read as "tap to go".
//   - Sections separated by a thin border-top + the uppercase label.
//   - Tighter row text (14px) + more vertical padding (14px) for
//     thumb-friendly tapping without feeling sparse.
function MoreSheet({
  isSignedIn,
  username,
  email,
  imageUrl,
  onClose,
  onSignOut,
}: {
  isSignedIn: boolean;
  username: string | null;
  email: string | null;
  imageUrl: string | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  // Secondary destinations — order = discoverability priority
  // (most-likely-used first).
  //
  // Wishlist is listed FIRST as a fallback for the routes where the
  // top sticky search bar (which hosts the primary Wishlist button)
  // is hidden: /admin, /checkout, /sign-in, /sign-up, /listings/new,
  // /kyc/verify, /offline, /notifications, dealer-verification. On
  // any of those pages users still have one tap to wishlist via
  // this More-sheet entry.
  const shopLinks = [
    { href: '/wishlist', label: 'Wishlist' },
    { href: '/?listingType=TAKE_A_SHOT', label: 'Take a Shot' },
    { href: '/competitions', label: 'Competitions' },
  ];
  // Account destinations now come from the shared ACCOUNT_GROUPS (rendered via
  // <AccountMenuList/>) so this sheet stays in lockstep with the desktop
  // dropdown + mobile drawer.
  const pathname = usePathname();
  const legalLinks = [
    { href: '/terms', label: 'Terms of service' },
    { href: '/privacy', label: 'Privacy policy' },
    { href: '/refund-policy', label: 'Refund & disputes' },
    { href: '/legal', label: 'All legal documents' },
  ];

  const displayName = username ?? 'Member';
  // First letter for the avatar fallback. Prefer username, then email.
  const initial = (
    username?.charAt(0) ??
    email?.charAt(0) ??
    'M'
  ).toUpperCase();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 56,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="More"
        aria-modal="true"
        style={{
          width: '100%',
          maxHeight: '88dvh',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          borderTop: '0.5px solid var(--border)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingTop: 6,
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
          animation: 'gg-sheet-up 240ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Drag-handle pill — pure visual cue, doesn't actually drag */}
        <div
          aria-hidden
          style={{
            width: 44,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-hover)',
            margin: '8px auto 12px',
          }}
        />

        {/* Profile header. Signed-in users see avatar + username + an
            "Account overview" chevron — tapping the whole card opens the
            /account hub (the flat grouped list still lives below, so the
            hub is additive). Signed-out users see a single Sign in pill.
            Sits flush at the top of the sheet to give the bottom-
            sheet a clear "this is YOUR drawer" anchor. */}
        {isSignedIn ? (
          <Link
            href="/account"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '0 12px 8px',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              textDecoration: 'none',
            }}
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={displayName}
                width={44}
                height={44}
                sizes="44px"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
                unoptimized
              />
            ) : (
              /* Initial-circle fallback when Clerk doesn't return an
                 imageUrl (rare but possible for non-OAuth sign-ups). */
              <span
                aria-hidden
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(200,16,46,0.18)',
                  color: 'var(--red)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {initial}
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {displayName}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                }}
              >
                Account overview
              </span>
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>
              <IconChevronRight />
            </span>
          </Link>
        ) : (
          <div style={{ padding: '0 12px 8px' }}>
            <SignInButton mode="modal">
              <button
                type="button"
                className="app-chrome"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign in or sign up
              </button>
            </SignInButton>
          </div>
        )}

        {isSignedIn && (
          <div style={{ marginTop: 8 }}>
            {/* Grouped account list (Buying / Selling / Competitions / Account)
                from the shared source of truth — same on every surface. */}
            <AccountMenuList
              pathname={pathname}
              onNavigate={onClose}
              showChevron
            />
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                borderTop: '0.5px solid var(--border-divider)',
              }}
            >
              {/* Push toggle — self-hides when push isn't supported /
                  backend isn't configured / iOS-in-browser. */}
              <PushToggleRow />
              <li>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="app-chrome"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 20px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--red)',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </li>
            </ul>
          </div>
        )}

        <Section title="Shop">
          {shopLinks.map((l) => (
            <SheetLink
              key={l.href}
              href={l.href}
              label={l.label}
              onNavigate={onClose}
            />
          ))}
        </Section>

        <Section title="Legal">
          {legalLinks.map((l) => (
            <SheetLink
              key={l.href}
              href={l.href}
              label={l.label}
              onNavigate={onClose}
            />
          ))}
        </Section>
      </div>

      <style>{`
        @keyframes gg-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      {/* Section header sits on top of a thin divider line so the
          sheet reads as grouped sections rather than one wall of
          links. */}
      <p
        style={{
          padding: '14px 20px 6px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          margin: 0,
          borderTop: '0.5px solid var(--border-divider)',
        }}
      >
        {title}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </div>
  );
}

function SheetLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <li>
      {/* Trailing chevron + tighter row text — reads as iOS Settings
          row rather than inert link text. */}
      <Link
        href={href}
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '13px 20px',
          color: 'var(--text-primary)',
          fontSize: 14,
          textDecoration: 'none',
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          <IconChevronRight />
        </span>
      </Link>
    </li>
  );
}
