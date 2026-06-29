'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SignInButton, UserButton, useUser, useClerk } from '@clerk/nextjs';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { ProfileCompletionRing } from '@/components/profile-completion-ring';
import { LiveSearch } from '@/components/live-search';
import { UrgentBell } from '@/components/urgent-bell';
import { CartButton } from '@/components/cart-button';
import { useInstallPrompt } from '@/lib/use-install-prompt';

export function Nav() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { canInstall, isInstalled, isStandalone, promptInstall } =
    useInstallPrompt();

  // Only worth offering in browser-mobile mode when not already installed.
  // (The drawer is md:hidden + the nav itself is hidden in standalone, so this
  // never shows to installed-app users.)
  const showInstall = !isInstalled && !isStandalone;

  async function handleInstall() {
    setMobileOpen(false);
    // Fire the native dialog if Chrome captured the event; otherwise pop our
    // instruction modal (the only install path then is the browser's ⋮ menu,
    // which we can explain but not trigger).
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') {
        window.dispatchEvent(new Event('gg:show-install-help'));
      }
    } else {
      window.dispatchEvent(new Event('gg:show-install-help'));
    }
  }

  // Pick the best name to display. Order of preference:
  //   1. Clerk username (the one we'll start asking for on signup)
  //   2. First + last name
  //   3. First name alone
  //   4. Email handle (everything before the @)
  // Always a string so the JSX doesn't need a fallback.
  const displayName = (() => {
    if (!user) return '';
    if (user.username) return user.username;
    const both = [user.firstName, user.lastName].filter(Boolean).join(' ');
    if (both) return both;
    if (user.firstName) return user.firstName;
    const email = user.primaryEmailAddress?.emailAddress ?? '';
    return email.split('@')[0] ?? '';
  })();

  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when the mobile drawer is open.
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // Shopping surfaces — shared between desktop nav row and mobile drawer.
  const SHOP_LINKS = [
    { href: '/?listingType=BUY_NOW', label: 'Marketplace' },
    { href: '/?listingType=AUCTION', label: 'Auctions' },
    { href: '/?listingType=TAKE_A_SHOT', label: 'Take a Shot' },
    { href: '/?listingType=SWOP', label: 'Swop / Trade' },
    { href: '/competitions', label: 'Competitions' },
  ];

  // Account menu items — shared between desktop dropdown and mobile drawer.
  // Wishlist sits at the top with the primary "View profile" link so the
  // desktop nav has parity with the installed-PWA bottom bar (where
  // Wishlist is one of the five primary tabs).
  const ACCOUNT_LINKS = [
    { href: '/profile', label: 'View profile', primary: true },
    { href: '/wishlist', label: 'Wishlist' },
    { href: '/my/listings', label: 'My Listings' },
    { href: '/my/orders', label: 'My Orders' },
    { href: '/my/sales', label: 'My Sales' },
    { href: '/my/offers', label: 'My Offers' },
    { href: '/my/bids', label: 'My Bids' },
    { href: '/my/tickets', label: 'My Tickets' },
    { href: '/dashboard/raffle-wins', label: 'My Wins' },
    { href: '/offers/received', label: 'Received Offers' },
    { href: '/dashboard', label: 'Dashboard' },
  ];

  return (
    <>
      <nav
        className="sticky top-0 z-50"
        style={{
          background: 'var(--bg-deep)',
          borderBottom: '0.5px solid var(--border)',
        }}
      >
        <div className="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-6">
          {/* Logo */}
          <Link href="/" className="shrink-0 flex items-center" aria-label="Gun Galore">
            <Image
              src="/logo.svg"
              alt="Gun Galore"
              width={220}
              height={44}
              priority
              style={{ height: 44, width: 'auto' }}
            />
          </Link>

          {/* Primary nav — four shopping surfaces. Desktop only; mobile
              users get these via the hamburger menu on the right. */}
          <div className="hidden md:flex items-center gap-5 text-sm shrink-0">
            {SHOP_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                style={{ color: 'var(--text-secondary)' }}
                className="hover:text-[#f5f5f5] transition-colors"
              >
                {link.label}
              </Link>
            ))}
            {/* Ask GG — paid AI assistant, deliberately set apart from
                SHOP_LINKS (it's not a shopping surface). Sparkles icon
                + slight accent so it reads as "different product". The
                installed-PWA equivalent is the dedicated tab in the
                bottom-tab-bar (5-tab layout, sparkles icon, same colour
                language). Mobile-web users reach it via the hamburger
                drawer's Assistant section below. */}
            <Link
              href="/ask-gg"
              style={{ color: 'var(--text-secondary)' }}
              className="flex items-center gap-1.5 hover:text-[#f5f5f5] transition-colors"
              aria-label="Ask GG — AI assistant"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path
                  d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              Ask GG
            </Link>
          </div>

          {/* Live search — desktop only. On mobile it lives inside the
              hamburger drawer so the nav stays uncluttered + the Sell
              CTA + hamburger don't get pushed off-screen. */}
          <div className="hidden md:block flex-1 max-w-[420px]">
            <LiveSearch placeholder="Search listings…" />
          </div>

          {/* Right side */}
          {isLoaded && (
            <div className="flex items-center gap-2 sm:gap-3 ml-auto md:ml-0">
              <Link
                href="/listings/new"
                className="text-sm px-3 py-1.5 rounded-[6px] transition-colors"
                style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
              >
                Sell
              </Link>

              {/* Urgent-notifications bell — shows a red count badge only
                  when there are must-act items (replaces the old always-on
                  sticky strip). Visible on desktop + mobile-web; the
                  installed-PWA bottom tab bar has its own bell. Self-gates
                  to signed-in users. */}
              <UrgentBell />

              {/* Cart (Phase 8b) — single-seller multi-item basket. Hidden
                  when empty. Visible on desktop + mobile-web. */}
              <CartButton />

              {/* Desktop sign-in / account chip. Mobile uses hamburger. */}
              <div className="hidden md:flex items-center gap-3">
                {isSignedIn ? (
                  <>
                    <ProfileCompletionRing />
                    {displayName && (
                      <Link
                        href="/profile"
                        className="hidden sm:inline text-sm transition-colors"
                        style={{
                          color: 'var(--text-secondary)',
                          textDecoration: 'none',
                          maxWidth: 160,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={displayName}
                      >
                        {displayName}
                      </Link>
                    )}
                    <div className="relative" ref={menuRef}>
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="text-sm px-2.5 py-1.5 rounded-[6px]"
                        style={{
                          color: 'var(--text-secondary)',
                          border: '0.5px solid var(--border)',
                        }}
                      >
                        Account ▾
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 mt-1 w-48 rounded-[8px] py-1 z-50"
                          style={{
                            background: 'var(--bg-card)',
                            border: '0.5px solid var(--border)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                          }}
                        >
                          {ACCOUNT_LINKS.map(({ href, label, primary }) => {
                            const isActive = (() => {
                              if (!pathname) return false;
                              if (href === '/profile')
                                return pathname === '/profile';
                              return (
                                pathname === href ||
                                pathname.startsWith(href + '/')
                              );
                            })();
                            return (
                              <Link
                                key={href}
                                href={href}
                                onClick={() => setMenuOpen(false)}
                                className="block px-3 py-2 text-sm transition-colors"
                                style={{
                                  color: isActive
                                    ? '#fff'
                                    : primary
                                      ? 'var(--text-primary)'
                                      : 'var(--text-secondary)',
                                  background: isActive
                                    ? 'rgba(200,16,46,0.14)'
                                    : 'transparent',
                                  borderLeft: isActive
                                    ? '2px solid var(--red)'
                                    : '2px solid transparent',
                                  paddingLeft: isActive ? 10 : 12,
                                  textDecoration: 'none',
                                  fontWeight: isActive || primary ? 500 : 400,
                                  borderBottom: primary
                                    ? '0.5px solid var(--border)'
                                    : undefined,
                                  marginBottom: primary ? 4 : undefined,
                                  paddingBottom: primary ? 10 : undefined,
                                }}
                              >
                                {label}
                              </Link>
                            );
                          })}
                          <div
                            style={{
                              borderTop: '0.5px solid var(--border)',
                              marginTop: 4,
                              paddingTop: 4,
                            }}
                          >
                            <button
                              type="button"
                              onClick={async () => {
                                setMenuOpen(false);
                                await signOut();
                                router.push('/');
                              }}
                              className="block w-full text-left px-3 py-2 text-sm transition-colors"
                              style={{
                                color: 'var(--red)',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              Sign out
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <UserButton />
                  </>
                ) : (
                  <SignInButton mode="modal">
                    <button
                      className="text-sm px-3 py-1.5 rounded-[6px]"
                      style={{
                        color: 'var(--text-secondary)',
                        border: '0.5px solid var(--border)',
                      }}
                    >
                      Sign in
                    </button>
                  </SignInButton>
                )}
              </div>

              {/* Mobile hamburger — opens the drawer below. md:hidden so it
                  only shows on phones / narrow tablets where the page links
                  + search + sign-in have all been pushed into the drawer. */}
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="md:hidden p-2 rounded-[6px]"
                style={{
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                }}
                aria-label="Open menu"
              >
                {/* 3-bar hamburger icon as inline SVG so we don't add an
                    icon-library dependency just for one glyph. */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ─── Mobile drawer ──────────────────────────────────────────────
          Full-height slide-in from the right. Contains everything that's
          hidden from the mobile nav: search, page links, sign-in/account.
          z-50 nav has z-50; backdrop + panel above at z-[60] / z-[70]. */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-[60]"
            style={{ background: 'rgba(0,0,0,0.55)', cursor: 'default' }}
            aria-label="Close menu"
          />

          {/* Slide-in panel */}
          <div
            className="md:hidden fixed top-0 right-0 bottom-0 z-[70] overflow-y-auto"
            style={{
              width: 'min(86vw, 360px)',
              background: 'var(--bg-deep)',
              borderLeft: '0.5px solid var(--border)',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
          >
            {/* Drawer header — logo on left, close button on right */}
            <div
              className="flex items-center justify-between px-4 h-14"
              style={{ borderBottom: '0.5px solid var(--border)' }}
            >
              <Image
                src="/logo.svg"
                alt="Gun Galore"
                width={160}
                height={32}
                style={{ height: 32, width: 'auto' }}
              />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-[6px]"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Close menu"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
              <LiveSearch placeholder="Search listings…" />
            </div>

            {/* Shop section */}
            <div className="px-4 py-4">
              <p
                className="text-xs uppercase mb-2"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
              >
                Shop
              </p>
              <nav className="flex flex-col gap-1">
                {SHOP_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="px-3 py-3 rounded-[6px] text-base"
                    style={{
                      color: 'var(--text-primary)',
                      textDecoration: 'none',
                      background: 'transparent',
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            {/* Get the app — manual install entry. Chrome no longer auto-
                prompts; this gives mobile-web users a reliable, on-demand way
                to install. Fires the native dialog when Chrome has the event
                ready, else shows the browser-menu steps. Hidden once installed
                / in the standalone app. */}
            {showInstall && (
              <div
                className="px-4 py-4"
                style={{ borderTop: '0.5px solid var(--border)' }}
              >
                <p
                  className="text-xs uppercase mb-2"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
                >
                  Get the app
                </p>
                <button
                  type="button"
                  onClick={handleInstall}
                  className="w-full px-3 py-3 rounded-[6px] text-base flex items-center gap-2"
                  style={{
                    color: '#fff',
                    background: 'var(--red)',
                    border: 'none',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Install Gun Galore
                </button>
                <p
                  className="text-xs mt-2"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
                >
                  Home-screen icon, faster launches, works offline.
                </p>
              </div>
            )}

            {/* Assistant section — Ask GG. Separate from Shop because
                it's a paid AI feature, not a shopping surface. On the
                installed PWA the equivalent entry is the dedicated
                bottom-tab-bar tab; here in the mobile-web drawer it
                lives as its own section so the entry is discoverable
                even outside the installed app. */}
            <div
              className="px-4 py-4"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <p
                className="text-xs uppercase mb-2"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
              >
                Assistant
              </p>
              <Link
                href="/ask-gg"
                className="px-3 py-3 rounded-[6px] text-base flex items-center gap-2"
                style={{
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  background: 'transparent',
                  fontWeight: 500,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  style={{ color: 'var(--red)' }}
                >
                  <path
                    d="M12 4 L13.6 9.4 L19 11 L13.6 12.6 L12 18 L10.4 12.6 L5 11 L10.4 9.4 Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M18.5 4 L19 5.5 L20.5 6 L19 6.5 L18.5 8 L18 6.5 L16.5 6 L18 5.5 Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                Ask GG
              </Link>
            </div>

            {/* Account section — what's shown depends on sign-in state */}
            <div
              className="px-4 py-4"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              <p
                className="text-xs uppercase mb-2"
                style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
              >
                Account
              </p>
              {isSignedIn ? (
                <>
                  {displayName && (
                    <p
                      className="px-3 pb-2 text-sm"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Signed in as <span style={{ color: 'var(--text-primary)' }}>{displayName}</span>
                    </p>
                  )}
                  <nav className="flex flex-col gap-1">
                    {ACCOUNT_LINKS.map(({ href, label, primary }) => (
                      <Link
                        key={href}
                        href={href}
                        className="px-3 py-3 rounded-[6px] text-base"
                        style={{
                          color: primary
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                          textDecoration: 'none',
                          fontWeight: primary ? 500 : 400,
                          borderBottom: primary
                            ? '0.5px solid var(--border)'
                            : undefined,
                          marginBottom: primary ? 6 : undefined,
                          paddingBottom: primary ? 12 : undefined,
                        }}
                      >
                        {label}
                      </Link>
                    ))}
                    <button
                      type="button"
                      onClick={async () => {
                        setMobileOpen(false);
                        await signOut();
                        router.push('/');
                      }}
                      className="px-3 py-3 rounded-[6px] text-base text-left mt-2"
                      style={{
                        color: 'var(--red)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        borderTop: '0.5px solid var(--border)',
                      }}
                    >
                      Sign out
                    </button>
                  </nav>
                </>
              ) : (
                <SignInButton mode="modal">
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="w-full px-3 py-3 rounded-[6px] text-base"
                    style={{
                      background: 'var(--red)',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Sign in
                  </button>
                </SignInButton>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
