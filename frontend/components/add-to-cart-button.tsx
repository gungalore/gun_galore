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
        {/* Board review — Buy CTA typography (display face, 700, sized up
            from the body-font 500 this used to render at). Same treatment
            as the Buy Now button on the listing page; appearance only. */}
        <Link
          href="/cart"
          className="flex-1 py-3 rounded-[6px] text-[14.5px] lg:text-[13.5px] text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)', color: 'var(--red)', fontFamily: 'var(--font-head)', fontWeight: 700 }}
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
      // Board review — Buy CTA typography: display face (Archivo) at 700
      // (was body-font 500), plus a cart icon (16px, matches the nav
      // CartButton glyph) since this is "the add-to-cart action". Flex
      // replaces block+text-center so the icon sits on the text baseline
      // instead of just floating inline before it.
      className="flex w-full items-center justify-center gap-1.5 py-3 rounded-[6px] text-[14.5px] lg:text-[13.5px] text-center mb-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-head)', fontWeight: 700 }}
    >
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      Add to cart
    </button>
  );
}
