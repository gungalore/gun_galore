'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getAdminToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('admin_token='))
      ?.split('=')[1] ?? ''
  );
}

// Inline form at the top of the Banned tab. Banned bidders are blocked
// from placing new bids on featured slots; the backend also voids any
// in-flight top bid they currently hold (per banned-bidders module).
export function BanForm() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (!userId.trim() || !reason.trim()) {
      setError('User ID and reason are required');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/featured/banned-bidders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: userId.trim(), reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setUserId('');
      setReason('');
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ban failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-xs uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        Ban a bidder
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label
            className="text-xs mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            User ID
          </label>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="cuid…"
            className="w-full px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
            }}
          />
        </div>
        <div>
          <label
            className="text-xs mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Reason
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. shill bidding"
            className="w-full px-3 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs mb-3" style={{ color: '#22c55e' }}>
          Bidder banned.
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !userId.trim() || !reason.trim()}
        className="px-4 py-2 rounded-[6px] text-sm font-medium"
        style={{
          background:
            busy || !userId.trim() || !reason.trim()
              ? 'var(--bg-inset)'
              : 'var(--red)',
          color:
            busy || !userId.trim() || !reason.trim()
              ? 'var(--text-tertiary)'
              : '#fff',
          border:
            busy || !userId.trim() || !reason.trim()
              ? '0.5px solid var(--border)'
              : 'none',
          cursor:
            busy || !userId.trim() || !reason.trim()
              ? 'not-allowed'
              : 'pointer',
        }}
      >
        {busy ? 'Banning…' : 'Ban bidder'}
      </button>
    </div>
  );
}
