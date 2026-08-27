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
import { useWishlist } from '@/lib/use-wishlist';
import { installPlatform, useInstallPrompt } from '@/lib/use-install-prompt';
import { trackInstall } from '@/lib/activity-beacon';
import { AccountMenuList, LogoutIcon } from '@/lib/account-menu';
import { CategoryMenu } from '@/components/category-menu';

// The nav is a singleton, so a fixed id is safe and keeps aria-controls on
// the search button pointing at the panel without threading a useId through.
const MOBILE_SEARCH_PANEL_ID = 'nav-mobile-search-panel';

// Desktop wishlist icon — same TapTarget-style badge approach as
// shell-header.tsx's RootHeader wishlist icon (link to /wishlist, badge
// shows the saved count from useWishlist), redrawn at CartButton's visual
// weight (44x44, unbordered, 20px glyph) since the two now sit side by side
// in the icon cluster. Desktop-only (hidden md:inline-flex): mobile-web's
// row is already at capacity with Sell/bell/cart/hamburger, and the board
// this reorder follows only models the desktop cluster.
function WishlistNavButton() {
  const { count } = useWishlist();
  return (
    <Link
      href="/wishlist"
      aria-label={count > 0 ? `Wishlist, ${count} saved` : 'Wishlist'}
      className="relative hidden md:inline-flex items-center justify-center"
      style={{ width: 44, height: 44 }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--text-secondary)' }}
        aria-hidden="true"
      >
        <path d="M12 20.3 C7 15.9 3.5 12.9 3.5 9.3 A4.3 4.3 0 0 1 12 6.6 4.3 4.3 0 0 1 20.5 9.3 C20.5 12.9 17 15.9 12 20.3 Z" />
      </svg>
      {count > 0 && (
        <span
          className="absolute"
          style={{
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: 'var(--red)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export function Nav() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Mobile-web search: no permanent search chrome on phones any more. The
  // icon beside Sell opens a panel under the top row, and a closed panel
  // renders NOTHING — no reserved height, nothing pinned to the viewport.
  // (The installed PWA hides this whole nav, so it keeps its own header bar.)
  const [searchOpen, setSearchOpen] = useState(false);
  const {
    canInstall,
    isInstalled,
    isStandalone,
    isIosSafari,
    isIosNonSafari,
    promptInstall,
  } = useInstallPrompt();

  // Only worth offering in browser-mobile mode when not already installed.
  // (The drawer is md:hidden + the nav itself is hidden in standalone, so this
  // never shows to installed-app users.)
  const showInstall = !isInstalled && !isStandalone;

  async function handleInstall() {
    const platform = installPlatform({ isIosSafari, isIosNonSafari });
    trackInstall('clicked', platform, 'nav');
    setMobileOpen(false);
    // Fire the native dialog if Chrome captured the event; otherwise pop our
    // instruction modal (the only install path then is the browser's ⋮ menu,
    // which we can explain but not trigger).
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') trackInstall('completed', platform, 'nav');
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
    // Escape closes the dropdown too (basic keyboard affordance — the
    // outside-click listener alone stranded keyboard users).
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Same affordance for the mobile search panel — it has no visible
        // close button, so Escape is the keyboard way back out.
        setSearchOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
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
  // Cut to two on 2026-08-26. Take a Shot moved INTO the listing page as an
  // offer on a Buy Now item, so it is no longer a browse surface; Swop, Daily
  // Deals and the Prize Draw were removed as modules.
  const SHOP_LINKS = [
    { href: '/?listingType=BUY_NOW', label: 'Buy Now' },
    { href: '/?listingType=AUCTION', label: 'Auctions' },
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
        <div className="max-w-[var(--page-max)] mx-auto px-4 h-[var(--nav-h)] flex items-center gap-3 sm:gap-6">
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
              src={av('/logo-mark-dark.svg')}
              alt="All Outdoor"
              width={36}
              height={36}
              priority
              className="h-9 w-auto object-contain sm:hidden"
            />
            <Image
              src={av('/logo-nav-dark.svg')}
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
              variant="attached"
              className="flex-1"
            />
          </div>

          {/* ⚠️ OUTSIDE THE isLoaded GATE, ON PURPOSE.
              Everything in the cluster below waits on Clerk, so on a cold
              load the whole right side is empty until auth resolves. Search
              needs no auth state, and the sticky bar it replaced WAS
              server-rendered — leaving it in the gate would have made search
              appear later than it used to. Its own ml-auto pins it right; the
              cluster's ml-auto then has no free space left to take, so the two
              sit flush and the row still reads [search][Sell][bell][cart][menu]. */}
          <div className="md:hidden ml-auto shrink-0">
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
          </div>

          {/* Right side */}
          {isLoaded && (
            <div className="flex items-center gap-2 sm:gap-3 ml-auto md:ml-0 shrink-0">

              {/* Icons-first ordering (board review, 2026-08-27): wishlist →
                  cart → bell → avatar → Sell, Sell last as the one CTA in the
                  cluster. Wishlist is desktop-only (see WishlistNavButton);
                  the rest were already shared across breakpoints and just
                  moved position, so mobile-web keeps its bell/cart/Sell/
                  hamburger row unchanged in substance. */}
              <WishlistNavButton />

              {/* Cart (Phase 8b) — single-seller multi-item basket. Always
                  rendered (only the count badge is conditional) so the cart is
                  a permanent, findable destination. Desktop + mobile-web only:
                  this whole nav is display:none in the installed PWA, which
                  gets its cart from TopCartButton instead. */}
              <CartButton />

              {/* Urgent-notifications bell — shows a red count badge only
                  when there are must-act items (replaces the old always-on
                  sticky strip). Visible on desktop + mobile-web; the
                  installed-PWA bottom tab bar has its own bell. Self-gates
                  to signed-in users. The board's cluster doesn't model
                  notifications at all, so this stays put among the icons
                  rather than being dropped — desktop's only entry point. */}
              <UrgentBell />

              {/* Desktop sign-in / account chip. Mobile uses hamburger. */}
              <div className="hidden md:flex items-center gap-3">
                {isSignedIn ? (
                  <>
                    {/* `relative` and the menuRef were positioning
                        context for the dropdown that used to hang off
                        this tile. The menu is gone; the wrapper stays
                        only to keep the flex row's spacing. */}
                    <div>
                      {/* One consolidated account tile: avatar + name +
                          chevron. Replaces the old separate name link,
                          "Account ▾" button, and Clerk UserButton. The
                          avatar is wrapped in AvatarCompletionRing, which
                          draws a profile-completeness arc hugging it and
                          vanishes at 100%. */}
                      {/* ⚠️ A LINK, NOT A MENU TRIGGER (operator,
                          2026-08-27). This opened a 27-link dropdown; the
                          account tile page is the design's answer to the
                          same need, so the avatar just goes there.
                          aria-expanded / aria-haspopup went with the menu:
                          announcing a popup that no longer exists is worse
                          than announcing nothing. */}
                      <Link
                        href="/account"
                        aria-label="Your account"
                        className="gg-press"
                        style={{
                          textDecoration: 'none',
                          color: 'var(--text-primary)',
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
                      </Link>
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

              {/* Sell — last in the cluster (board review, 2026-08-27): icons
                  and the account tile read first, the one CTA reads last.
                  Two renders, not one: the board's 38px / Archivo 700 /
                  13.5px / "Sell your gear" spec is drawn for the desktop
                  cluster only, and this codebase treats 44px as the phone
                  tap-target floor (see CartButton, the hamburger below) —
                  so mobile keeps the original 44px / weight-500 "Sell"
                  rather than shrinking a primary CTA under that floor. */}
              <Link
                href="/listings/new"
                className="md:hidden text-sm px-3 rounded-[6px] transition-colors inline-flex items-center justify-center"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontWeight: 500,
                  minHeight: 44,
                }}
              >
                Sell
              </Link>
              <Link
                href="/listings/new"
                className="hidden md:inline-flex items-center justify-center rounded-[6px] transition-colors"
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  fontFamily: 'var(--font-display), Archivo, sans-serif',
                  fontWeight: 700,
                  fontSize: 13.5,
                  height: 38,
                  padding: '0 14px',
                }}
              >
                Sell your gear
              </Link>

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
              autoFocus
              // Search pushes "/?q=…" — a query-only change usePathname()
              // never sees — so the panel has to be told to close.
              onNavigate={() => setSearchOpen(false)}
            />
          </div>
        )}

        {/* ⚠️ THE SECOND TIER IS GONE (2026-08-27). It carried the Buy Now /
            Auctions links on their own slim desktop strip, and existed only
            because the storefront had nowhere else to put the two modes. The
            design pack's header — identical across nine desktop boards, each
            carrying the authored note "lifted from OptionE so the chrome is
            identical site-wide" — is a SINGLE 62px row with no such tier, and
            the modes now live in the Shop-by-mode tiles under the hero.

            THE TRADE-OFF, STATED PLAINLY: those tiles are on the homepage only,
            so from a listing or cart page the two modes are now two clicks
            (logo → home → tile) rather than one. That is what the design
            specifies, consistently, on every board — but it is a real
            reduction. If it bites, the fix is a mode entry in the Categories
            flyout, not this strip back.

            SHOP_LINKS survives: it still feeds the mobile drawer's Shop
            section, which is how phones reach the modes. */}
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
                src={av('/logo-nav-dark.svg')}
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
