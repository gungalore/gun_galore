'use client';

import { useState } from 'react';
import Link from 'next/link';
import { addToCart, removeFromCart, replaceCart, useCart, type CartItem } from '@/lib/cart-store';

// Add-to-cart for the listing detail page. Rendered ONLY for ACTIVE BUY_NOW
// non-firearm listings that aren't the viewer's own (the parent gates this).
// Single-seller: adding from a different seller prompts replace-or-cancel.
export function AddToCartButton({ item }: { item: CartItem }) {
  const cart = useCart();
  const inCart = cart.some((i) => i.listingId === item.listingId);
  const [conflict, setConflict] = useState<string | null>(null);

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
    <div className="mb-3">
      <button
        type="button"
        onClick={() => {
          const res = addToCart(item);
          if (res.status === 'seller-conflict') setConflict(res.currentSeller);
        }}
        className="block w-full py-3 rounded-[6px] text-sm text-center"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Add to cart
      </button>
      {conflict && (
        <div
          className="mt-2 rounded-[6px] p-3 text-xs"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Your cart already has items from <strong>{conflict}</strong>. A cart can
          only hold one seller&apos;s items (one payment per order).
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                // Replace: discard the other seller's cart, start fresh.
                replaceCart(item);
                setConflict(null);
              }}
              className="px-3 py-1.5 rounded-[5px]"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Start new cart with this item
            </button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="px-3 py-1.5 rounded-[5px]"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}
            >
              Keep current cart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
