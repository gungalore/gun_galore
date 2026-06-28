'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cart-store';

// Cart entry point for the nav header. Badge shows the line count; the cart
// itself is single-seller (Phase 8b). Hidden when empty to avoid clutter.
export function CartButton() {
  const items = useCart();
  const n = items.length;
  if (n === 0) return null;
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${n} item${n === 1 ? '' : 's'}`}
      className="relative inline-flex items-center justify-center"
      style={{ width: 36, height: 36 }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--text-secondary)' }}
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
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
        {n}
      </span>
    </Link>
  );
}
