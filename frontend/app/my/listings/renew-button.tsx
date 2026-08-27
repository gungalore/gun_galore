'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// "Still for sale" — answers the 75-day staleness nudge. Resets the
// listing's renewal clock so the daily sweep doesn't expire it at 90 days.
// Only rendered for ACTIVE non-auction listings inside the ageing window
// (see MyListingsPage), so the button is a real signal to the seller that
// something is about to happen, not permanent chrome.
export default function RenewButton({
  listingId,
  daysOld,
}: {
  listingId: string;
  daysOld: number;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRenew() {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/listings/${listingId}/renew`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not renew');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className="px-2.5 py-1 text-xs" style={{ color: 'var(--success)' }}>
        ✓ Renewed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={handleRenew}
        disabled={busy}
        title={`Listed ${daysOld} days ago — confirm it's still available so it isn't expired at 90 days`}
        className="px-2.5 py-1 rounded text-xs"
        style={{
          color: 'var(--text-primary)',
          border: '0.5px solid var(--border)',
          background: 'var(--bg-inset)',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Renewing…' : 'Still for sale'}
      </button>
      {error && (
        <span className="text-xs" style={{ color: 'var(--red)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
