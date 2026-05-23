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
// Four tabs (one row, well-spaced):
//   1. Shop  → opens a bottom sheet with 5 shopping surfaces:
//              All listings / Marketplace / Auctions / Take a Shot /
//              Competitions. Tap any row → navigate to that surface.
//   2. Sell  → /listings/new (centred, brand-red accent)
//   3. My    → /dashboard (signed-in) / /sign-in (signed-out)
//   4. More  → bottom sheet with secondary destinations (Wishlist,
//              account links, legal).
//
// Active-route highlighting via usePathname() + a search-aware match
// helper (so /?listingType=AUCTION lights up the Shop tab even
// though the pathname is just '/').

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SignInButton, useUser, useClerk } from '@clerk/nextjs';
import { useStandalone } from '@/lib/use-standalone';

interface Tab {
  key: string;
  label: string;
  href: string;
  // Returns true when the active route belongs to this tab.
  isActive: (pathname: string, search: URLSearchParams) => boolean;
  // Accent tabs (currently just Sell) keep brand-red iconography even
  // when not the active route — signals "primary action" without
  // breaking the even 4-column grid.
  accent?: boolean;
  // 'shop' / 'more' opens a sheet instead of navigating.
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

export function BottomTabBar() {
  const isStandalone = useStandalone();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const [shopOpen, setShopOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Auto-close any open sheet on route change (mirrors the mobile-drawer
  // behaviour in nav.tsx).
  useEffect(() => {
    setShopOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Body-scroll lock while either sheet is open.
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
      key: 'sell',
      label: 'Sell',
      href: '/listings/new',
      isActive: (p) => p.startsWith('/listings/new'),
      accent: true,
    },
    {
      key: 'my',
      label: 'My',
      href: isSignedIn ? '/dashboard' : '/sign-in',
      isActive: (p) => p.startsWith('/dashboard') || p.startsWith('/my/'),
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
      case 'sell':
        return <IconPlus />;
      case 'my':
        return <IconUser />;
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
        }}
      >
        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            height: 60,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.isActive(pathname, searchParams);
            // Active tab → brand red, regardless of accent state.
            // Accent tab (Sell) → brand red even when inactive, so it
            // reads as the primary action across the bar.
            // Everything else → muted tertiary.
            const color = active || tab.accent
              ? 'var(--red)'
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
                  fontWeight: active || tab.accent ? 600 : 500,
                  letterSpacing: 0.1,
                  textDecoration: 'none',
                }}
              >
                {renderIcon(tab.key)}
                <span>{tab.label}</span>
              </span>
            );

            return (
              <li key={tab.key} style={{ height: '100%' }}>
                {tab.action ? (
                  <button
                    type="button"
                    onClick={() =>
                      tab.action === 'shop'
                        ? setShopOpen(true)
                        : setMoreOpen(true)
                    }
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
      href: '/',
      title: 'All listings',
      tagline: 'Everything on sale right now, across every surface',
      icon: <IconList />,
      isActive: pathname === '/' && !searchParams.get('listingType'),
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
function MoreSheet({
  isSignedIn,
  onClose,
  onSignOut,
}: {
  isSignedIn: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  // Secondary destinations — the ones that didn't earn a tab. Order =
  // discoverability priority (most-likely-used first).
  const shopLinks = [
    { href: '/?listingType=TAKE_A_SHOT', label: 'Take a Shot' },
    { href: '/competitions', label: 'Competitions' },
    { href: '/wishlist', label: 'Wishlist' },
  ];
  const accountLinks = isSignedIn
    ? [
        { href: '/profile', label: 'Profile' },
        { href: '/my/listings', label: 'My listings' },
        { href: '/my/orders', label: 'My orders' },
        { href: '/my/sales', label: 'My sales' },
        { href: '/my/offers', label: 'My offers' },
        { href: '/my/bids', label: 'My bids' },
        { href: '/my/tickets', label: 'My tickets' },
        { href: '/dashboard/raffle-wins', label: 'My raffle wins' },
        { href: '/offers/received', label: 'Received offers' },
      ]
    : [];
  const legalLinks = [
    { href: '/terms', label: 'Terms of service' },
    { href: '/privacy', label: 'Privacy policy' },
    { href: '/refund-policy', label: 'Refund & disputes' },
    { href: '/legal', label: 'All legal documents' },
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
        aria-label="More"
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
            margin: '8px auto 14px',
          }}
        />

        <Section title="Shop">
          {shopLinks.map((l) => (
            <SheetLink key={l.href} href={l.href} label={l.label} />
          ))}
        </Section>

        {isSignedIn ? (
          <Section title="My account">
            {accountLinks.map((l) => (
              <SheetLink key={l.href} href={l.href} label={l.label} />
            ))}
            <button
              type="button"
              onClick={onSignOut}
              className="app-chrome"
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 20px',
                background: 'transparent',
                border: 'none',
                color: 'var(--red)',
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </Section>
        ) : (
          <Section title="Account">
            <div style={{ padding: '8px 20px 16px' }}>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="app-chrome"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'var(--red)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Sign in
                </button>
              </SignInButton>
            </div>
          </Section>
        )}

        <Section title="Legal">
          {legalLinks.map((l) => (
            <SheetLink key={l.href} href={l.href} label={l.label} />
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
    <div style={{ marginBottom: 6 }}>
      <p
        style={{
          padding: '14px 20px 6px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          margin: 0,
        }}
      >
        {title}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </div>
  );
}

function SheetLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        style={{
          display: 'block',
          padding: '12px 20px',
          color: 'var(--text-primary)',
          fontSize: 15,
          textDecoration: 'none',
        }}
      >
        {label}
      </Link>
    </li>
  );
}
