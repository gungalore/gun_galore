'use client';

// TopWishlistButton — heart-icon button that sits in the 25% slot
// next to the sticky search bar at the top of the PWA (see
// MobileSearchBar). Replaces the bottom-tab Wishlist slot — the
// thinking is that pairing wishlist with search keeps "save for
// later" one tap away on every page where the user might be
// shopping.
//
// Behaviour:
//   - Heart icon centred in the button
//   - Red count-pill in the top-right corner when count > 0
//     (same style as the Alerts bell + the old bottom-tab wishlist
//     slot — keeps the visual vocabulary consistent)
//   - Signed-out: links to /sign-in?redirect_url=/wishlist so the
//     tap brings them back to wishlist after auth (matches the
//     old bottom-tab wishlist behaviour)
//   - Active when the user is on /wishlist (red border)
//
// Standalone-only by design — it's mounted inside MobileSearchBar
// which already self-gates to standalone mode. Browser-mobile and
// desktop users keep their existing wishlist entry points (the
// hamburger drawer's Account section + the desktop nav dropdown).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useWishlist } from '@/lib/use-wishlist';

function IconHeart() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function TopWishlistButton() {
  const { isSignedIn } = useUser();
  const pathname = usePathname();
  const wishlist = useWishlist();

  const active = pathname.startsWith('/wishlist');
  const href = isSignedIn ? '/wishlist' : '/sign-in?redirect_url=/wishlist';

  return (
    <Link
      href={href}
      aria-label={`Wishlist${wishlist.count > 0 ? `, ${wishlist.count} saved` : ''}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        height: '100%',
        minHeight: 38, // matches LiveSearch input's vertical bounds
        padding: '0 14px',
        borderRadius: 6,
        background: active ? 'rgba(200,16,46,0.10)' : 'var(--bg-inset)',
        border: active
          ? '0.5px solid var(--red)'
          : '0.5px solid var(--border)',
        color: active ? 'var(--red)' : 'var(--text-secondary)',
        textDecoration: 'none',
        transition: 'background 140ms, border-color 140ms, color 140ms',
      }}
    >
      <IconHeart />
      {wishlist.count > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            right: 4,
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
            border: '1.5px solid var(--bg-deep)',
          }}
        >
          {wishlist.count > 50 ? '50+' : wishlist.count}
        </span>
      )}
    </Link>
  );
}
