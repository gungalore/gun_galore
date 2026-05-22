'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function OfferActions({
  offerId,
  action,
}: {
  offerId: string;
  action: 'counter' | 'withdraw';
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function call(endpoint: string, label: string) {
    setLoading(label);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/offers/${offerId}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      {action === 'counter' && (
        <div className="flex gap-2">
          <button
            onClick={() => call('accept-counter', 'accept')}
            disabled={!!loading}
            className="flex-1 py-2 rounded-[6px] text-sm font-medium"
            style={{
              background: loading === 'accept' ? 'var(--bg-inset)' : 'var(--red)',
              color: loading === 'accept' ? 'var(--text-tertiary)' : '#fff',
            }}
          >
            {loading === 'accept' ? 'Accepting…' : 'Accept counter'}
          </button>
          <button
            onClick={() => call('reject-counter', 'reject')}
            disabled={!!loading}
            className="flex-1 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: loading === 'reject' ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            }}
          >
            {loading === 'reject' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      )}

      {action === 'withdraw' && (
        <button
          onClick={() => call('withdraw', 'withdraw')}
          disabled={!!loading}
          className="text-xs"
          style={{ color: loading ? 'var(--text-tertiary)' : 'var(--text-tertiary)' }}
        >
          {loading ? 'Withdrawing…' : 'Withdraw offer'}
        </button>
      )}

      {error && <p className="text-xs mt-1.5" style={{ color: 'var(--red)' }}>{error}</p>}
    </div>
  );
}
