'use client';

import { useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { useRouter } from 'next/navigation';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

// Private Arrangement handover (Phase 4 W2). Funds are HELD: the seller marks
// "Item delivered", the buyer confirms "Item received" (which releases the
// seller's payment), or either party raises a dispute (funds frozen for admin).
export default function PrivateArrangePanel({
  txId,
  isBuyer,
  isSeller,
  delivered,
  received,
}: {
  txId: string;
  isBuyer: boolean;
  isSeller: boolean;
  delivered: string | null;
  received: string | null;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(action: 'delivered' | 'received' | 'dispute') {
    setBusy(action);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${txId}/private-arrange/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action === 'dispute' ? { reason: 'Raised from order page' } : {}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
        Private Arrangement — confirm the handover
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        You arranged this handover directly. The seller&rsquo;s payment is held
        until you confirm you received the item — or 5 days after payment.
        {delivered && !received ? ' The seller has marked it delivered.' : ''}
        {received ? ' Receipt confirmed — payment released to the seller.' : ''}
      </p>

      {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {isSeller && !delivered && (
          <button
            type="button"
            onClick={() => post('delivered')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {busy === 'delivered' ? 'Saving…' : 'Mark as delivered'}
          </button>
        )}
        {isBuyer && delivered && !received && (
          <button
            type="button"
            onClick={() => post('received')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {busy === 'received' ? 'Releasing…' : 'I received it'}
          </button>
        )}
        {(isBuyer || isSeller) && !received && (
          <button
            type="button"
            onClick={() => post('dispute')}
            disabled={busy !== null}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-50"
          >
            {busy === 'dispute' ? 'Raising…' : 'Raise a dispute'}
          </button>
        )}
      </div>
    </div>
  );
}
