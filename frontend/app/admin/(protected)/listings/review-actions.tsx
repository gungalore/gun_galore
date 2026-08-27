'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

export default function ReviewActions({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function doReview(action: 'APPROVE' | 'REJECT') {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/listings/${listingId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        // Surface the rejection instead of silently pretending success —
        // a moderation decision the backend refused must not look done.
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? `${action} failed (${res.status})`);
        return;
      }
      setShowReject(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  // A rejection ALWAYS emails the seller, so it must always carry a why.
  // Same >=5-char rule the bulk-actions table already enforces, and now the
  // backend enforces it too (a bare "your listing was rejected" email is what
  // this prevents).
  const reasonOk = reason.trim().length >= 5;

  if (showReject) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[180px]">
        <input
          className="px-2 py-1 rounded text-xs outline-none"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          placeholder="Reason — sent to the seller"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Rejection reason, sent to the seller"
        />
        <div className="flex gap-1">
          <button
            onClick={() => doReview('REJECT')}
            disabled={busy || !reasonOk}
            title={reasonOk ? undefined : 'Give the seller a reason (at least 5 characters)'}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              opacity: busy || !reasonOk ? 0.5 : 1,
              cursor: busy || !reasonOk ? 'not-allowed' : 'pointer',
            }}
          >
            Confirm reject
          </button>
          <button
            onClick={() => { setShowReject(false); setError(null); }}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <button
          onClick={() => doReview('APPROVE')}
          disabled={busy}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: '#22c55e18', color: '#22c55e', border: '0.5px solid #22c55e40', opacity: busy ? 0.6 : 1 }}
        >
          Approve
        </button>
        <button
          onClick={() => setShowReject(true)}
          disabled={busy}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: 'var(--red-wash)', color: 'var(--red)', border: '0.5px solid var(--red-line)' }}
        >
          Reject
        </button>
      </div>
      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
      )}
    </div>
  );
}
