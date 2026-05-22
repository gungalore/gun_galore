'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
}

export default function TransactionActions({ txId }: { txId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [note, setNote] = useState('');

  async function post(action: 'release' | 'refund') {
    setBusy(true);
    try {
      await fetch(`${API_URL}/admin/transactions/${txId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: action === 'refund' ? JSON.stringify({ note: note || undefined }) : undefined,
      });
      router.refresh();
    } finally {
      setBusy(false);
      setShowRefund(false);
    }
  }

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
            onClick={() => setShowRefund(false)}
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
        onClick={() => post('release')}
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
        style={{ background: 'var(--red)18', color: 'var(--red)', border: '0.5px solid var(--red)40' }}
      >
        Refund
      </button>
    </div>
  );
}
