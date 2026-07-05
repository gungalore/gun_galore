'use client';

// UX-2 — live wishlist count for the /account hub's Wishlist row. Reads the
// client WishlistProvider so the number stays in sync with the heart toggles
// elsewhere. Self-hides at 0 / before hydration.

import { useWishlist } from '@/lib/use-wishlist';

export function AccountWishlistCount() {
  const { count, ready } = useWishlist();
  if (!ready || count <= 0) return null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        padding: '1px 8px',
        minWidth: 20,
        textAlign: 'center',
      }}
    >
      {count}
    </span>
  );
}
