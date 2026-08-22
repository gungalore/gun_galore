'use client';

// TopWishlistButton — heart-icon button beside the sticky search bar at the
// top of the PWA (see MobileSearchBar). Replaces the bottom-tab Wishlist slot
// — pairing wishlist with search keeps "save for later" one tap away on every
// page where the user might be shopping.
//
// Signed-out taps route through /sign-in?redirect_url=/wishlist so the user
// lands where they were headed (matches the old bottom-tab behaviour).
//
// Standalone-only by design. MobileSearchBar returns null outside the
// installed PWA (it self-gates on useStandalone), so this button can only ever
// appear there and needs no gate of its own. Browser-mobile and desktop keep
// their existing wishlist entry points (the hamburger drawer's Account section
// + the desktop nav dropdown).
//
// Presentation lives in TopBarIconButton, shared with TopCartButton — see the
// note there on why these two can't be allowed to drift apart.

import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useWishlist } from '@/lib/use-wishlist';
import { TopBarIconButton } from '@/components/top-bar-icon-button';

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

  return (
    <TopBarIconButton
      href={isSignedIn ? '/wishlist' : '/sign-in?redirect_url=/wishlist'}
      label={`Wishlist${wishlist.count > 0 ? `, ${wishlist.count} saved` : ''}`}
      active={pathname.startsWith('/wishlist')}
      count={wishlist.count}
    >
      <IconHeart />
    </TopBarIconButton>
  );
}
