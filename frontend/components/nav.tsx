'use client';

import Link from 'next/link';
import Image from 'next/image';
import { SignInButton, UserButton, useUser, useClerk } from '@clerk/nextjs';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { ProfileCompletionRing } from '@/components/profile-completion-ring';

export function Nav() {
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <nav
      className="sticky top-0 z-50"
      style={{
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-6">
        {/* Logo — full wordmark SVG. The spec locks the 5:1 aspect ratio;
            44px tall is the nav-bar size per CLAUDE.md. */}
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

        {/* Primary nav — four shopping surfaces. Marketplace = BUY_NOW
            listings, Auctions = AUCTION, Take a Shot = TAKE_A_SHOT, and
            Competitions is its own page. The hero is reserved for the bare
            "/" landing — clicking any surface link drops the hero so the
            user lands directly on the filtered results. */}
        <div className="flex items-center gap-5 flex-1 text-sm">
          <Link
            href="/?listingType=BUY_NOW"
            style={{ color: 'var(--text-secondary)' }}
            className="hover:text-[#f5f5f5] transition-colors"
          >
            Marketplace
          </Link>
          <Link
            href="/?listingType=AUCTION"
            style={{ color: 'var(--text-secondary)' }}
            className="hover:text-[#f5f5f5] transition-colors"
          >
            Auctions
          </Link>
          <Link
            href="/?listingType=TAKE_A_SHOT"
            style={{ color: 'var(--text-secondary)' }}
            className="hover:text-[#f5f5f5] transition-colors"
          >
            Take a Shot
          </Link>
          <Link
            href="/competitions"
            style={{ color: 'var(--text-secondary)' }}
            className="hover:text-[#f5f5f5] transition-colors"
          >
            Competitions
          </Link>
        </div>

        {/* Right side */}
        {isLoaded && (
          <div className="flex items-center gap-3">
            <Link
              href="/listings/new"
              className="text-sm px-3 py-1.5 rounded-[6px] transition-colors"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Sell
            </Link>

            {isSignedIn ? (
              <div className="flex items-center gap-2">
                {/* Wishlist icon removed — the join table + heart
                    toggle on listing cards aren't built yet, and
                    advertising a feature whose page literally says
                    "coming soon" makes the rest of the surface feel
                    half-finished. Re-add the heart here when the
                    wishlist join table + card toggle ship. */}

                {/* Messages icon removed — there is no buyer/seller
                    messaging on Gun Galore. Pre-purchase Q&A lives on
                    the listing page; PRIVATE_ARRANGE swaps contact
                    details on payment. */}

                {/* Ambient profile-completion ring — sits next to the
                    user chip. Renders a small percent circle while the
                    user has missing fields (name / verified phone /
                    address with coords); hides itself at 100%. Clicking
                    pops a tooltip with deep-links to /profile/edit.
                    Drives the "complete your profile" UX without ever
                    blocking the seller or popping a modal. */}
                <ProfileCompletionRing />

                {/* Display name — shows on every page since the nav
                    lives in the root layout. Links to /profile so it
                    doubles as a shortcut. Hidden on very narrow viewports
                    to keep the icons + dropdown fitting. */}
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

                {/* Account dropdown */}
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="text-sm px-2.5 py-1.5 rounded-[6px]"
                    style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
                  >
                    Account ▾
                  </button>
                  {menuOpen && (
                    <div
                      className="absolute right-0 mt-1 w-48 rounded-[8px] py-1 z-50"
                      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                    >
                      {[
                        // "View profile" is intentionally first — primary entry
                        // point to the full profile page (separated from the
                        // rest by a divider for visual hierarchy).
                        { href: '/profile', label: 'View profile', primary: true },
                        { href: '/my/listings', label: 'My Listings' },
                        { href: '/my/orders', label: 'My Orders' },
                        { href: '/my/sales', label: 'My Sales' },
                        { href: '/my/offers', label: 'My Offers' },
                        { href: '/my/bids', label: 'My Bids' },
                        { href: '/my/tickets', label: 'My Tickets' },
                        { href: '/dashboard/raffle-wins', label: 'My Wins' },
                        { href: '/offers/received', label: 'Received Offers' },
                        { href: '/dashboard', label: 'Dashboard' },
                        // 'Verify Identity' is NOT exposed here on purpose.
                        // Each /kyc/verify run burns a VerifyNow lookup (real
                        // money), so KYC is only triggered when the platform
                        // actually needs it — first sale for a seller, winning
                        // a high-value raffle, etc. — never by a curious user
                        // clicking from a menu.
                      ].map(({ href, label, primary }) => {
                        // Highlight the active item so the user
                        // always knows which dashboard they're on.
                        // Path comparison is exact for /profile (so
                        // /profile/edit doesn't also light up) and
                        // prefix for /my/* + /dashboard/* + /offers/*
                        // so nested routes still highlight their parent.
                        const isActive = (() => {
                          if (!pathname) return false;
                          if (href === '/profile') return pathname === '/profile';
                          return (
                            pathname === href || pathname.startsWith(href + '/')
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

                      {/* Sign out — separated by a divider, in red so it
                          reads as the destructive/exit action. The Clerk
                          <UserButton /> popup is unreliable in our dev
                          env so this is the primary sign-out path. */}
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
              </div>
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
        )}
      </div>
    </nav>
  );
}
