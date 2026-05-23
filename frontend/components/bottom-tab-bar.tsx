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
// Five tabs:
//   1. Browse    → /
//   2. Auctions  → /?listingType=AUCTION
//   3. Sell      → /listings/new   (centred, brand-red accent)
//   4. My        → /dashboard (signed-in) / /sign-in (signed-out)
//   5. More      → opens a bottom-sheet drawer with everything else
//
// Active-route highlighting via usePathname() + a search-aware match
// helper (so /?listingType=AUCTION lights up the Auctions tab even
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
  // Centred-prominent tabs (currently just Sell) get red-accented
  // styling and slightly larger.
  prominent?: boolean;
  // 'more' opens the sheet instead of navigating.
  action?: 'more';
}

// Inline SVG icons — no extra dep. 24×24 viewbox, currentColor stroke
// so the active state can tint via `color: var(--red)`.
function IconHome() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
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
  const [moreOpen, setMoreOpen] = useState(false);

  // Auto-close the More sheet on route change (mirrors the mobile-drawer
  // behaviour in nav.tsx).
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Body-scroll lock while the More sheet is open.
  useEffect(() => {
    if (moreOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [moreOpen]);

  // Server HTML stays identical to browser-mobile — the tab bar only
  // exists for installed PWA users. The CSS rule that pads the body
  // (`html[data-standalone='true'] body { padding-bottom: ... }`)
  // still applies regardless so the layout is consistent.
  if (!isStandalone) return null;

  const tabs: Tab[] = [
    {
      key: 'browse',
      label: 'Browse',
      href: '/',
      isActive: (p, s) =>
        p === '/' && (!s.get('listingType') || s.get('listingType') === 'BUY_NOW'),
    },
    {
      key: 'auctions',
      label: 'Auctions',
      href: '/?listingType=AUCTION',
      isActive: (p, s) => p === '/' && s.get('listingType') === 'AUCTION',
    },
    {
      key: 'sell',
      label: 'Sell',
      href: '/listings/new',
      isActive: (p) => p.startsWith('/listings/new'),
      prominent: true,
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
      case 'browse':
        return <IconHome />;
      case 'auctions':
        return <IconGavel />;
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
                      // Slight raised effect — gives the central action visual weight.
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
                {tab.action === 'more' ? (
                  <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    aria-label="More"
                    aria-expanded={moreOpen}
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
