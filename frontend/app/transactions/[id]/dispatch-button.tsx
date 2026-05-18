'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Transaction } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

export function DispatchButton({ tx }: { tx: Transaction }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [trackingRef, setTrackingRef] = useState('');
  const [pudoId, setPudoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div
        className="rounded-[6px] px-4 py-3 text-sm"
        style={{ background: 'rgba(0,160,60,0.10)', color: '#00a03c', border: '0.5px solid rgba(0,160,60,0.2)' }}
      >
        Dispatch confirmed. Buyer has been notified.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 }}
      >
        Confirm dispatch
      </button>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, string> = {};
      if (trackingRef) body.trackingReference = trackingRef;
      if (tx.shippingMethod === 'PUDO' && pudoId) body.pudoDropoffLockerId = pudoId;

      const res = await fetch(`${API_URL}/transactions/${tx.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          className="px-3 py-2 rounded-[6px] text-sm"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {tx.shippingMethod === 'PUDO' && (
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Pudo drop-off locker ID (optional)
          </label>
          <input
            type="text"
            value={pudoId}
            onChange={(e) => setPudoId(e.target.value)}
            placeholder="e.g. PUD-12345"
            style={inputStyle}
          />
        </div>
      )}

      <div>
        <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Tracking reference (optional)
        </label>
        <input
          type="text"
          value={trackingRef}
          onChange={(e) => setTrackingRef(e.target.value)}
          placeholder="e.g. TCG123456789"
          style={inputStyle}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="flex-1 py-2.5 rounded-[6px] text-sm"
          style={{
            background: loading ? 'var(--bg-inset)' : 'var(--red)',
            color: loading ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {loading ? 'Confirming…' : 'Confirm dispatch'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-2.5 rounded-[6px] text-sm"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
