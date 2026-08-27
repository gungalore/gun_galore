'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

// Inline money actions on the transactions LIST. Release moves the buyer's
// held money to the seller — the most consequential one-click in admin — so
// it now requires an explicit confirm step (mirrors the dossier's
// DossierActions), and BOTH actions surface backend rejections inline
// instead of silently pretending success.
export default function TransactionActions({ txId }: { txId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function post(action: 'release' | 'refund') {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/transactions/${txId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'refund' ? JSON.stringify({ note: note || undefined }) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? `${action} failed (${res.status})`);
        return; // keep the confirm open so the admin sees the error
      }
      setShowRefund(false);
      setShowRelease(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p className="text-xs" style={{ color: 'var(--red)' }}>
      {error}
    </p>
  );

  if (showRefund) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[180px]">
        <input
          className="px-2 py-1 rounded text-xs outline-none"
          style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          placeholder="Refund note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-1">
          <button
            onClick={() => post('refund')}
            disabled={busy}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            Confirm refund
          </button>
          <button
            onClick={() => { setShowRefund(false); setError(null); }}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Cancel
          </button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (showRelease) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[180px]">
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Release the held payment to the seller? This can&apos;t be undone.
        </p>
        <div className="flex gap-1">
          <button
            onClick={() => post('release')}
            disabled={busy}
            className="flex-1 px-2 py-1 rounded text-xs font-medium"
            style={{ background: '#22c55e', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            Confirm release
          </button>
          <button
            onClick={() => { setShowRelease(false); setError(null); }}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Cancel
          </button>
        </div>
        {errorLine}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => setShowRelease(true)}
        disabled={busy}
        className="px-2.5 py-1 rounded text-xs font-medium"
        style={{ background: '#22c55e18', color: '#22c55e', border: '0.5px solid #22c55e40', opacity: busy ? 0.6 : 1 }}
      >
        Release
      </button>
      <button
        onClick={() => setShowRefund(true)}
        disabled={busy}
        className="px-2.5 py-1 rounded text-xs font-medium"
        style={{ background: 'var(--red-wash)', color: 'var(--red)', border: '0.5px solid var(--red-line)' }}
      >
        Refund
      </button>
    </div>
  );
}
