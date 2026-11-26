'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Cancel-listing flow with a consequence preview. Before the seller
// confirms, we fetch the listing detail to count active bids (the API
// already includes bidCount on GET /listings/:id). The preview shows what
// cancelling will break — offers will decline, and any in-progress checkout
// will fail. Auctions are the exception: once a bid exists the server refuses
// to cancel and the UI says so instead of offering a confirm (audit H4/M12).

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
        // The server is now the authority on cancellation: an auction with
        // bids answers 409/400 with the real reason. Show that message rather
        // than a generic failure — it is the only explanation the seller gets
        // (audit H4).
        const body = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        const message = Array.isArray(body.message)
          ? body.message.join(', ')
          : (body.message ?? `Error ${res.status}`);
        throw new Error(message);
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
        style={{ background: 'transparent', color: 'var(--danger-edge)', border: '1.5px solid var(--danger-edge)' }}
      >
        Cancel
      </button>
    );
  }

  // Audit H4/M12 — an auction with bids cannot be cancelled. The server now
  // refuses (409/400), and the old preview promised bidders would be notified
  // and any holds released, which never happened (auction bids move no money).
  // So the confirm is not offered at all once bids exist: the dialog becomes a
  // blocked explanation.
  const blockedByBids =
    summary?.listingType === 'AUCTION' && summary.bidCount > 0;

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
          {blockedByBids ? 'This auction can’t be cancelled' : 'Cancel this listing?'}
        </p>

        {loadingSummary ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Checking what this will affect…
          </p>
        ) : blockedByBids ? (
          <p
            className="text-sm"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            This auction has bids on it and can no longer be cancelled. Let it
            run, or contact support if something is wrong.
          </p>
        ) : summary ? (
          <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            <p>
              The listing will be removed from search and the marketplace.
              You can't undo this - relist it later if you change your mind.
            </p>
            <p className="text-xs">
              Old cancelled listings are archived and their photos are removed
              to keep storage costs down. Order and payment records are kept.
            </p>

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
          {loadingSummary || blockedByBids ? (
            // While the bid count is still being read, and once it is known
            // that the auction cannot be cancelled, the destructive confirm is
            // not offered — a seller must never be able to fire a DELETE
            // before the preview has told them what it would do.
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-visible)',
                cursor: 'pointer',
              }}
            >
              {loadingSummary ? 'Close' : 'Got it'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 py-2 rounded text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-visible)',
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
                  background: busy ? 'var(--bg-inset)' : 'var(--danger-fill)',
                  color: busy ? 'var(--text-tertiary)' : 'var(--danger-ink)',
                  border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
