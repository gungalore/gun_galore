'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

export default function ReviewActions({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  async function doReview(action: 'APPROVE' | 'REJECT') {
    setBusy(true);
    try {
      await adminFetch(`/admin/listings/${listingId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: reason || undefined }),
      });
      router.refresh();
    } finally {
      setBusy(false);
      setShowReject(false);
    }
  }

  if (showReject) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[180px]">
        <input
          className="px-2 py-1 rounded text-xs outline-none"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-1">
          <button
            onClick={() => doReview('REJECT')}
            disabled={busy}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            Confirm reject
          </button>
          <button
            onClick={() => setShowReject(false)}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
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
        style={{ background: 'var(--red)18', color: 'var(--red)', border: '0.5px solid var(--red)40' }}
      >
        Reject
      </button>
    </div>
  );
}
