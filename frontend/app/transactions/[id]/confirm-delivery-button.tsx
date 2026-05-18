'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export function ConfirmDeliveryButton({ transactionId }: { transactionId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/confirm-delivery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setConfirming(false);
    }
  }

  if (!asked) {
    return (
      <button
        onClick={() => setAsked(true)}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{ background: '#00a03c', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }}
      >
        I have received the item
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Confirming delivery will release payment to the seller. This cannot be undone.
      </p>
      {error && (
        <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="flex-1 py-2.5 rounded-[6px] text-sm"
          style={{
            background: confirming ? 'var(--bg-inset)' : '#00a03c',
            color: confirming ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: confirming ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {confirming ? 'Confirming…' : 'Yes, confirm delivery'}
        </button>
        <button
          onClick={() => setAsked(false)}
          className="px-4 py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
