'use client';

import Link from 'next/link';
import { addToCart, removeFromCart, useCart, type CartItem } from '@/lib/cart-store';

// Add-to-cart for the listing detail page. Rendered for ACTIVE BUY_NOW
// listings (incl. firearms — they branch to dealer/in-person routing in the
// cart) that aren't the viewer's own (the parent gates this). A cart may mix
// sellers (Phase 8d) — no single-seller prompt.
export function AddToCartButton({ item }: { item: CartItem }) {
  const cart = useCart();
  const inCart = cart.some((i) => i.listingId === item.listingId);

  if (inCart) {
    return (
      <div className="flex gap-2 mb-3">
        <Link
          href="/cart"
          className="flex-1 py-3 rounded-[6px] text-sm text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)', color: 'var(--red)', fontWeight: 500 }}
        >
          In cart ✓ — View cart
        </Link>
        <button
          type="button"
          onClick={() => removeFromCart(item.listingId)}
          className="px-3 py-3 rounded-[6px] text-sm"
          style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
          aria-label="Remove from cart"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        const result = addToCart(item);
        // UX-4 — pop the added-to-cart drawer only on a genuine add (not when
        // the line is already in the cart). The drawer is a global listener
        // mounted in the layout; the cart store itself stays untouched.
        if (result.status === 'added') {
          window.dispatchEvent(
            new CustomEvent('gg:added-to-cart', { detail: { item } }),
          );
        }
      }}
      className="block w-full py-3 rounded-[6px] text-sm text-center mb-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontWeight: 500 }}
    >
      Add to cart
    </button>
  );
}
