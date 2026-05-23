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

// Close an OPEN auction right now — the backend awards the top bid
// (if any) and transitions to BIND_WINDOW. If no bids, the auction
// closes as CLOSED_NO_BIDS and the slot stays vacant.
export function CloseAuctionEarlyButton({
  slotId,
  slotNumber,
}: {
  slotId: string;
  slotNumber: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = getAdminToken();
      const res = await fetch(
        `${API_URL}/admin/featured/slots/${slotId}/close-auction-early`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-2 rounded-[6px]"
        style={{
          background: 'var(--bg-inset)',
          color: 'var(--text-primary)',
          border: '0.5px solid var(--border)',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Close auction now
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="rounded-[8px] p-6 max-w-md w-full"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Close auction early — Slot #{slotNumber}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              The current OPEN auction will close now. If there is a top
              bid, the winner enters the bind window. If no bids, the
              auction closes with no winner and the slot stays vacant.
            </p>

            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Reason (logged in audit)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-[6px] text-sm mb-4"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                resize: 'vertical',
              }}
              autoFocus
            />

            {error && (
              <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 py-2.5 rounded-[6px] text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !reason.trim()}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                style={{
                  background:
                    busy || !reason.trim() ? 'var(--bg-inset)' : 'var(--red)',
                  color:
                    busy || !reason.trim() ? 'var(--text-tertiary)' : '#fff',
                  border:
                    busy || !reason.trim()
                      ? '0.5px solid var(--border)'
                      : 'none',
                  cursor:
                    busy || !reason.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Closing…' : 'Close auction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
