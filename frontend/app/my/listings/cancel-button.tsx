'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Cancel-listing flow with a consequence preview. Before the seller
// confirms, we fetch the listing detail to count active bids + pending
// offers (the API already includes these on GET /listings/:id). The
// confirm modal shows what cancelling will break — bids will be
// refunded, offers will decline, and any in-progress checkout will
// fail. Without this preview a seller can silently cancel an active
// auction and only learn from angry buyers.

interface ListingSummary {
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  bidCount: number;
  activeOfferCount?: number;
}

export default function CancelButton({ listingId }: { listingId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ListingSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  async function openConfirm() {
    setOpen(true);
    if (summary) return; // already loaded
    setLoadingSummary(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const l = await res.json();
        // Active offers aren't included by default on listing GET;
        // we'd need a separate endpoint. For now we only show bids
        // (which IS on the response) — offers stay silent in the
        // preview. Worth a follow-up to expose pending-offer count.
        setSummary({
          listingType: l.listingType,
          bidCount: l.bidCount ?? 0,
        });
      }
    } finally {
      setLoadingSummary(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openConfirm}
        className="px-2.5 py-1 rounded text-xs"
        style={{ color: 'var(--red)', border: '0.5px solid var(--red)40' }}
      >
        Cancel
      </button>
    );
  }

  return (
    <div
      onClick={() => !busy && setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 460,
          width: '100%',
          padding: 24,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--red)',
        }}
      >
        <p
          className="text-base mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Cancel this listing?
        </p>

        {loadingSummary ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Checking what this will affect…
          </p>
        ) : summary ? (
          <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            <p>
              The listing will be removed from search and the marketplace.
              You can't undo this — relist it later if you change your mind.
            </p>

            {summary.listingType === 'AUCTION' && summary.bidCount > 0 && (
              <div
                className="rounded-[6px] p-3"
                style={{
                  background: 'rgba(200,16,46,0.08)',
                  border: '0.5px solid var(--red)',
                }}
              >
                <p style={{ color: 'var(--red)', fontWeight: 500 }}>
                  ⚠ {summary.bidCount} active bid
                  {summary.bidCount === 1 ? '' : 's'}
                </p>
                <p className="text-xs mt-1">
                  All bidders will be notified and any holds released.
                  Cancelling an auction with bids hurts your seller trust
                  score.
                </p>
              </div>
            )}

            {summary.listingType === 'TAKE_A_SHOT' && (
              <p className="text-xs">
                Any pending offers on this listing will be declined.
                Buyers can't re-offer on a cancelled listing.
              </p>
            )}

            {summary.listingType === 'BUY_NOW' && (
              <p className="text-xs">
                If a buyer is mid-checkout, their session will fail.
                If they've already paid, cancel via the transaction page
                (refund) instead.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Could not load listing details — proceed with caution.
          </p>
        )}

        {error && (
          <p className="text-xs mt-3" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Keep listing
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: busy ? 'var(--bg-inset)' : 'var(--red)',
              color: busy ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Cancelling…' : 'Yes, cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
