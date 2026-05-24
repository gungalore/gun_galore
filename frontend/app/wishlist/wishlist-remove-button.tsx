'use client';

// Inline "Remove" pill rendered next to greyed-out tombstone rows on
// /wishlist (saved listings that have gone SOLD / CANCELLED / EXPIRED
// / REMOVED). Re-uses the WishlistProvider's optimistic toggle so the
// row disappears immediately on click; the page reloads on next visit
// (server-fetched) to pick up the new list.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWishlist } from '@/lib/use-wishlist';

export function WishlistRemoveButton({ listingId }: { listingId: string }) {
  const { toggle, isSaved } = useWishlist();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // If a previous client toggle already removed this listing
  // (e.g. via the heart on the live card), don't render at all.
  if (!isSaved(listingId)) return null;

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await toggle(listingId);
      // Server-side fetched list needs a refresh to drop the row.
      router.refresh();
    } catch {
      // Fall through — the optimistic toggle already rolled back
      // inside the hook, so the row stays visible.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        background: 'transparent',
        border: '0.5px solid var(--border)',
        color: 'var(--text-tertiary)',
        fontSize: 12,
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}
