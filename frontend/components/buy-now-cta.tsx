'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { addToCart, type CartItem } from '@/lib/cart-store';

/**
 * The Buy CTA, with sign-in moved to the click.
 *
 * Content is behind the 18+ gate, so a signed-out visitor CAN see a listing.
 * Buying, however, is an action and needs an account. This component sends a
 * signed-out click straight to sign-in with the checkout URL as the return
 * path, instead of navigating to `/checkout/...` only for the middleware to
 * bounce it — the difference is one wasted page load and a moment of "why am
 * I on this screen?".
 *
 * A signed-in member gets a plain Link, unchanged. Until the session has
 * loaded we render the Link: navigation to checkout still funnels through
 * middleware, so an early click is safe, never a dead end.
 *
 * 2026-11-26 operator: "when the user exits a buy now the item is gone with no
 * trace to be found, buy now should also be added to the cart". Clicking Buy
 * therefore adds the line to the local cart FIRST (no drawer/modal interruption)
 * before navigating to checkout. Abandoning the checkout leaves the item in
 * /cart; a completed purchase removes it again on the confirmation step.
 */
export function BuyNowCta({
  listingId,
  cartItem,
  className,
  style,
  children,
}: {
  listingId: string;
  /** The cart line to keep as a trace when the buyer leaves checkout. Omit
   *  for listings the cart cannot carry (e.g. collection-only). */
  cartItem?: CartItem | null;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const href = `/checkout/${listingId}`;

  function rememberInCart() {
    if (!cartItem) return;
    try {
      addToCart(cartItem);
    } catch {
      /* localStorage unavailable — checkout still works */
    }
  }

  if (isLoaded && !isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => {
          rememberInCart();
          router.push(`/sign-in?redirect_url=${encodeURIComponent(href)}`);
        }}
        className={className}
        style={{ ...style, border: style?.border ?? 'none', cursor: 'pointer' }}
      >
        {children}
      </button>
    );
  }

  return (
    <Link href={href} onClick={rememberInCart} className={className} style={style}>
      {children}
    </Link>
  );
}
