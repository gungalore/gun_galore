'use client';

import Link from 'next/link';
import { av } from '@/lib/asset-version';
import Image from 'next/image';
import { SignInButton, useUser, useClerk } from '@clerk/nextjs';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { AvatarCompletionRing } from '@/components/avatar-completion-ring';
import { LiveSearch } from '@/components/live-search';
import { UrgentBell } from '@/components/urgent-bell';
import { CartButton } from '@/components/cart-button';
import { useInstallPrompt } from '@/lib/use-install-prompt';
import { AccountMenuList, LogoutIcon } from '@/lib/account-menu';
import { CategoryMenu } from '@/components/category-menu';

// The nav is a singleton, so a fixed id is safe and keeps aria-controls on
// the search button pointing at the panel without threading a useId through.
const MOBILE_SEARCH_PANEL_ID = 'nav-mobile-search-panel';

export function Nav() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Mobile-web search: no permanent search chrome on phones any more. The
  // icon beside Sell opens a panel under the top row, and a closed panel
  // renders NOTHING — no reserved height, nothing pinned to the viewport.
  // (The installed PWA hides this whole nav, so it keeps its own header bar.)
  const [searchOpen, setSearchOpen] = useState(false);
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
    // Escape closes the dropdown too (basic keyboard affordance — the
    // outside-click listener alone stranded keyboard users).
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        // Same affordance for the mobile search panel — it has no visible
        // close button, so Escape is the keyboard way back out.
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
    // Belt-and-braces for the search panel. Its own close path is
    // LiveSearch's onNavigate (search pushes "/?q=…", a query-only change
    // this effect can't see), so this only catches a real path change while
    // the panel happens to be open.
    setSearchOpen(false);
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
    { href: '/?listingType=BUY_NOW', label: 'Buy Now' },
    { href: '/?listingType=AUCTION', label: 'Auctions' },
    { href: '/?listingType=TAKE_A_SHOT', label: 'Take a Shot' },
    { href: '/?listingType=SWOP', label: 'Swop / Trade' },
    { href: '/deals', label: 'Daily Deals' },
    { href: '/raffle', label: 'Prize Draw' },
  ];

  // Account menu items now live in lib/account-menu.tsx (ACCOUNT_GROUPS) so the
  // desktop dropdown, mobile drawer, and installed-PWA More sheet all render
  // the same grouped list and can't drift apart. Rendered via <AccountMenuList/>.

  return (
    <>
      <nav
        className="sticky top-0 z-50"
        style={{
          background: 'var(--bg-deep)',
          borderBottom: '0.5px solid var(--border)',
        }}
      >
        <div className="max-w-[var(--page-max)] mx-auto px-4 h-14 flex items-center gap-3 sm:gap-6">
          {/* Logo — the composed nav lockup, and the MARK ALONE on phones.

              The nav constrains by HEIGHT, so shape decides width. The
              lockup is 6:1: at sm's h-11 that is ~340px, comfortable beside
              a flex-1 search box on a desktop row. At h-9 on a 375px phone it
              would be ~280px, which leaves nothing for the fixed-size
              Sell/bell/cart/hamburger cluster and pushes the row into
              horizontal overflow — the exact failure the old comment here was
              guarding against from the other direction.

              So phones get the monogram (square, ~36px) and everything from sm
              up gets the wordmark too. Both are the same artwork.

              /logo.svg still owns the hero, share cards and print. */}
          <Link
            href="/"
            className="shrink min-w-0 flex items-center"
            aria-label="All Outdoor"
          >
            <Image
              src={av('/logo-mark.svg')}
              alt="All Outdoor"
              width={36}
              height={36}
              priority
              className="h-9 w-auto object-contain sm:hidden"
            />
            <Image
              src={av('/logo-nav.svg')}
              alt="All Outdoor"
              width={264}
              height={44}
              priority
              className="hidden h-11 w-auto max-w-full object-contain sm:block"
            />
          </Link>

          {/* Category browse + live search, fused into one control
              (Takealot-style): a "Categories ▾" segment on the left of a
              wide search box. Desktop only + flex-1 so the search fills the
              row; mobile keeps search in the hamburger drawer. The selling-
              mode links moved to the slim second tier below so they no
              longer crush the search. */}
          <div
            className="hidden md:flex flex-1 max-w-[600px] items-stretch"
            style={{
              border: '0.5px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-inset)',
            }}
          >
            <CategoryMenu variant="search" />
            <LiveSearch
              placeholder="Search listings…"
              variant="attached"
              className="flex-1"
            />
          </div>

          {/* Right side */}
          {isLoaded && (
            <div className="flex items-center gap-2 sm:gap-3 ml-auto md:ml-0 shrink-0">
              {/* Mobile-web search trigger. md:hidden because from md up the
                  row already carries the Categories+search unit, and nothing
                  about the desktop nav changes.

                  Visual language is TopBarIconButton's (radius 6, inset
                  background, hairline border, secondary ink) but the SIZE is
                  this row's: 44 tall to line up with Sell / cart / hamburger,
                  and 36 wide — the same width as the bell it sits two slots
                  from. Width, not height, is the scarce resource here; see
                  the 320px arithmetic below. */}
              <button
                type="button"
                onClick={() => setSearchOpen((o) => !o)}
                className="md:hidden inline-flex items-center justify-center"
                style={{
                  width: 36,
                  height: 44,
                  flexShrink: 0,
                  borderRadius: 6,
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  lineHeight: 0,
                }}
                aria-label={searchOpen ? 'Close search' : 'Search'}
                aria-expanded={searchOpen}
                // Only advertised while the panel is mounted — an
                // aria-controls pointing at a missing id is an audit failure
                // (same rule LiveSearch's combobox follows).
                aria-controls={searchOpen ? MOBILE_SEARCH_PANEL_ID : undefined}
              >
                {/* Magnifying glass, inline SVG like every other glyph in
                    this file — no icon-library dependency for one shape. */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.2" y1="16.2" x2="21" y2="21" />
                </svg>
              </button>

              <Link
                href="/listings/new"
                className="text-sm px-3 rounded-[6px] transition-colors inline-flex items-center justify-center"
                // py-1.5 left this 32px tall. Height comes from minHeight now
                // so it matches the 44px cart and menu beside it — a row of
                // controls at three different heights also just looks untidy.
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  minHeight: 44,
                }}
              >
                Sell
              </Link>

              {/* Urgent-notifications bell — shows a red count badge only
                  when there are must-act items (replaces the old always-on
                  sticky strip). Visible on desktop + mobile-web; the
                  installed-PWA bottom tab bar has its own bell. Self-gates
                  to signed-in users. */}
              <UrgentBell />

              {/* Cart (Phase 8b) — single-seller multi-item basket. Always
                  rendered (only the count badge is conditional) so the cart is
                  a permanent, findable destination. Desktop + mobile-web only:
                  this whole nav is display:none in the installed PWA, which
                  gets its cart from TopCartButton instead. */}
              <CartButton />

              {/* Desktop sign-in / account chip. Mobile uses hamburger. */}
              <div className="hidden md:flex items-center gap-3">
                {isSignedIn ? (
                  <>
                    <div className="relative" ref={menuRef}>
                      {/* One consolidated account tile: avatar + name +
                          chevron. Replaces the old separate name link,
                          "Account ▾" button, and Clerk UserButton. The
                          avatar is wrapped in AvatarCompletionRing, which
                          draws a profile-completeness arc hugging it and
                          vanishes at 100%. */}
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-label="Account menu"
                        aria-expanded={menuOpen}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '2px 8px 2px 2px',
                          borderRadius: 999,
                          border: '0.5px solid var(--border)',
                          background: 'var(--bg-card)',
                          cursor: 'pointer',
                        }}
                      >
                        <AvatarCompletionRing>
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              overflow: 'hidden',
                              flexShrink: 0,
                              background: 'var(--red)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 13,
                              fontWeight: 500,
                            }}
                          >
                            {user?.imageUrl ? (
                              <Image
                                src={user.imageUrl}
                                alt=""
                                width={28}
                                height={28}
                                style={{ objectFit: 'cover' }}
                              />
                            ) : (
                              (displayName || 'G').charAt(0).toUpperCase()
                            )}
                          </span>
                        </AvatarCompletionRing>
                        <span
                          className="hidden sm:inline"
                          style={{
                            maxWidth: 210,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 14,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {/* "Welcome back," rides along on wide viewports
                              only, so the username itself never gets
                              ellipsed on narrower ones. Replaces the old
                              SignedInWelcome strip on the landing page. */}
                          <span
                            className="hidden lg:inline"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            Welcome back,{' '}
                          </span>
                          {displayName}
                        </span>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--text-tertiary)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                          style={{ marginRight: 2 }}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 mt-1 w-64 rounded-[8px] z-50 overflow-hidden"
                          style={{
                            background: 'var(--bg-card)',
                            border: '0.5px solid var(--border)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                            // Header + sign-out stay pinned; only the middle
                            // link list scrolls (it gets its own themed
                            // scrollbar). 88px ≈ nav height + breathing room.
                            maxHeight: 'calc(100vh - 88px)',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <Link
                            href="/account"
                            onClick={() => setMenuOpen(false)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '12px 14px',
                              borderBottom: '0.5px solid var(--border)',
                              textDecoration: 'none',
                              flexShrink: 0,
                            }}
                          >
                            {user?.imageUrl ? (
                              // Same avatar the chip shows — the header used
                              // to render a generic initial circle instead.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={user.imageUrl}
                                alt=""
                                width={34}
                                height={34}
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: '50%',
                                  background: 'var(--red)',
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 500,
                                  fontSize: 14,
                                  flexShrink: 0,
                                }}
                              >
                                {(displayName || 'G').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {displayName || 'Your account'}
                              </p>
                              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
                                Account overview
                              </p>
                            </div>
                          </Link>
                          <div className="gg-menu-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                            <AccountMenuList
                              pathname={pathname}
                              onNavigate={() => setMenuOpen(false)}
                              compact
                            />
                          </div>
                          <div style={{ borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={async () => {
                                setMenuOpen(false);
                                await signOut();
                                router.push('/');
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                width: '100%',
                                textAlign: 'left',
                                padding: '10px 12px',
                                color: 'var(--red)',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 13,
                              }}
                            >
                              <span style={{ display: 'inline-flex' }}>
                                <LogoutIcon />
                              </span>
                              Sign out
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
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
                className="md:hidden p-2 rounded-[6px] inline-flex items-center justify-center"
                style={{
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  // 44x44 minimum — see CartButton. This is the only way into
                  // navigation on a phone, so it is the last control that
                  // should be fiddly to hit.
                  minWidth: 44,
                  minHeight: 44,
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

        {/* Mobile search panel — opened by the icon above, rendered INSIDE
            the sticky nav so it drops directly beneath the top menu.

            Closed, this branch renders nothing at all: no wrapper, no
            reserved height, no permanent bar riding the top of the viewport.
            That is the whole point of the change.

            No body-scroll lock — this is a small panel, not the drawer, and
            locking scroll for it would be worse than the bar it replaces. */}
        {searchOpen && (
          <div
            id={MOBILE_SEARCH_PANEL_ID}
            className="md:hidden px-4 py-2"
            style={{ borderTop: '0.5px solid var(--border)' }}
          >
            <LiveSearch
              placeholder="Search listings…"
              autoFocus
              // Search pushes "/?q=…" — a query-only change usePathname()
              // never sees — so the panel has to be told to close.
              onNavigate={() => setSearchOpen(false)}
            />
          </div>
        )}

        {/* Second tier — selling-mode links + Ask Boet. Desktop only; keeps
            the selling modes fully visible on their own slim strip instead
            of crushing the search on the top row. Mobile reaches these via
            the hamburger drawer's Shop / Assistant sections. */}
        <div
          className="hidden md:block"
          style={{ borderTop: '0.5px solid var(--border)' }}
        >
          <div className="max-w-[var(--page-max)] mx-auto px-4 h-10 flex items-center gap-5 text-sm">
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
            {/* Ask Boet — paid AI assistant, set apart from SHOP_LINKS with a
                sparkles icon so it reads as a different product. Pushed to the
                right edge of the strip. Mobile-web reaches it via the drawer's
                Assistant section; the installed PWA has its own bottom tab. */}
            <Link
              href="/ask-gg"
              className="ask-gg-lure flex items-center gap-1.5"
              style={{
                color: '#fff',
                fontWeight: 500,
                background: 'rgba(200,16,46,0.14)',
                border: '0.5px solid rgba(200,16,46,0.55)',
                borderRadius: 999,
                padding: '3px 12px',
              }}
              aria-label="Ask Boet — AI assistant"
            >
              <svg
                width="14"
                height="14"
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
              Ask Boet
            </Link>
          </div>
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
                src={av('/logo-nav.svg')}
                alt="All Outdoor"
                width={96}
                height={36}
                style={{ height: 36, width: 'auto' }}
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
              <LiveSearch
                placeholder="Search listings…"
                onNavigate={() => setMobileOpen(false)}
              />
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
                    // MUST close explicitly: most Shop links are query-string
                    // variants of "/" (?listingType=…), so usePathname() never
                    // changes and the route-change effect below can't fire.
                    onClick={() => setMobileOpen(false)}
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
                  Install All Outdoor
                </button>
                <p
                  className="text-xs mt-2"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
                >
                  Home-screen icon, faster launches, works offline.
                </p>
              </div>
            )}

            {/* Assistant section — Ask Boet. Separate from Shop because
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
                onClick={() => setMobileOpen(false)}
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
                Ask Boet
              </Link>
            </div>

            {/* Account section — what's shown depends on sign-in state */}
            <div
              className="px-4 py-4"
              style={{ borderTop: '0.5px solid var(--border)' }}
            >
              {isSignedIn ? (
                <>
                  <Link
                    href="/account"
                    onClick={() => setMobileOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '2px 4px 14px',
                      textDecoration: 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: 'var(--red)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 500,
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {(displayName || 'G').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {displayName || 'Your account'}
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Account overview
                      </p>
                    </div>
                  </Link>
                  {/* Negative margins pull the grouped list to the drawer edges
                      (the container has px-4); rows carry their own 16px pad. */}
                  <div style={{ marginLeft: -16, marginRight: -16 }}>
                    <AccountMenuList
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setMobileOpen(false);
                        await signOut();
                        router.push('/');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        textAlign: 'left',
                        padding: '13px 16px',
                        color: 'var(--red)',
                        background: 'transparent',
                        border: 'none',
                        borderTop: '0.5px solid var(--border)',
                        cursor: 'pointer',
                        fontSize: 15,
                      }}
                    >
                      <span style={{ display: 'inline-flex' }}>
                        <LogoutIcon />
                      </span>
                      Sign out
                    </button>
                  </div>
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
