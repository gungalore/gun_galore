'use client';

// TopCartButton — cart entry point for the installed PWA.
//
// WHY THIS EXISTS: in standalone mode globals.css hides the whole top nav
// (`html[data-standalone='true'] [data-public-nav] { display: none }`), and the
// nav is where CartButton lives. The bottom tab bar that replaces it carries
// Shop / Alerts / Sell / Ask Boet / More — no cart — and the More sheet had no
// cart row either. So an installed user could ADD to the cart and then have no
// way to reach it, and no badge to tell them anything was in there. A cart the
// buyer can't see is a cart they don't check out.
//
// Same count semantics as the nav's CartButton: UNITS, not lines, because the
// badge answers "how much is waiting", not "how many rows does the store have".
//
// Standalone-only. The gate lives at the top of MobileSearchBar, which returns
// null outside the installed PWA: in a browser tab the nav's own CartButton is
// right there, and two carts in one viewport is just noise.

import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart-store';
import { TopBarIconButton } from '@/components/top-bar-icon-button';

function IconCart() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

export function TopCartButton() {
  const items = useCart();
  const pathname = usePathname();

  const count = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);

  return (
    <TopBarIconButton
      href="/cart"
      label={
        count === 0 ? 'Cart, empty' : `Cart, ${count} item${count === 1 ? '' : 's'}`
      }
      active={pathname.startsWith('/cart')}
      count={count}
    >
      <IconCart />
    </TopBarIconButton>
  );
}
