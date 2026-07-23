'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

// Force-evict pulls the current occupant off a slot RIGHT NOW. The
// refund checkbox lets admins simultaneously trigger a Peach refund
// for whatever the occupant paid — defaults OFF because the most
// common case is "wrong listing, no refund owed".
export function ForceEvictButton({
  slotId,
  slotNumber,
  listingTitle,
}: {
  slotId: string;
  slotNumber: number;
  listingTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
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
      const res = await adminFetch(
        `/admin/featured/slots/${slotId}/force-evict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim(), refund }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setOpen(false);
      setReason('');
      setRefund(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Force-evict failed');
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
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Force evict
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
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
              Force-evict Slot #{slotNumber}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              Remove{' '}
              <span style={{ color: 'var(--text-primary)' }}>
                {listingTitle}
              </span>{' '}
              from the slot immediately. The slot becomes vacant.
            </p>

            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Reason (required, logged in audit)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-[6px] text-sm mb-3"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                resize: 'vertical',
              }}
              autoFocus
            />

            <label
              className="flex items-center gap-2 mb-4 text-sm cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={refund}
                onChange={(e) => setRefund(e.target.checked)}
              />
              Refund occupant via payment provider
            </label>

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
                {busy ? 'Evicting…' : 'Force evict'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
