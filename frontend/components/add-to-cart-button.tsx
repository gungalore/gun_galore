'use client';

import Link from 'next/link';
import { addToCart, removeFromCart, useCart, type CartItem } from '@/lib/cart-store';

// Add-to-cart for the listing detail page. Rendered ONLY for ACTIVE BUY_NOW
// non-firearm listings that aren't the viewer's own (the parent gates this).
// A cart may mix sellers (Phase 8d) — no single-seller prompt.
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
      onClick={() => addToCart(item)}
      className="block w-full py-3 rounded-[6px] text-sm text-center mb-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontWeight: 500 }}
    >
      Add to cart
    </button>
  );
}
