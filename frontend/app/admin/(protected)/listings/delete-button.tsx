'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

// Admin take-down for ANY listing (ACTIVE, PENDING_REVIEW, SOLD,
// EXPIRED — anything except already-CANCELLED). Soft-deletes via
// POST /admin/listings/:id/delete, which:
//   - flips Listing.status → CANCELLED
//   - stamps adminOverrideReason with whatever reason is typed here
//   - removes the row from Meilisearch immediately
//   - emails the seller with the reason
//
// Reason is REQUIRED — the backend rejects empty submissions, and the
// inline UI also disables the confirm button until the operator
// types something.
export default function DeleteListingButton({
  listingId,
}: {
  listingId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/listings/${listingId}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { message?: string }).message ?? `Failed (${res.status})`,
        );
        return;
      }
      // Success — refresh the table so the row disappears (or shifts
      // to the CANCELLED tab).
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (open) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[220px]">
        <input
          autoFocus
          className="px-2 py-1 rounded text-xs outline-none"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          placeholder="Reason (visible to seller) *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy || !reason.trim()}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              opacity: busy || !reason.trim() ? 0.5 : 1,
              cursor: busy || !reason.trim() ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {busy ? 'Removing…' : 'Confirm delete'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReason('');
              setError(null);
            }}
            className="px-2 py-1 rounded text-xs"
            style={{
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <p
            className="text-xs"
            style={{ color: 'var(--red)' }}
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="text-xs px-2.5 py-1 rounded font-medium"
      style={{
        background: 'transparent',
        color: 'var(--red)',
        border: '0.5px solid var(--red)',
        cursor: 'pointer',
      }}
    >
      Delete
    </button>
  );
}
