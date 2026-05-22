'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getAdminToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('admin_token='))
      ?.split('=')[1] ?? ''
  );
}

// Shift the featuredUntil timestamp by N seconds — positive extends,
// negative shortens. Most common usage: comp +1 day after a platform
// outage. The new ETA preview helps the operator sanity-check the
// number before committing.
export function ShiftUntilButton({
  slotId,
  slotNumber,
  featuredUntil,
}: {
  slotId: string;
  slotNumber: number;
  featuredUntil: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deltaSeconds, setDeltaSeconds] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta = Number(deltaSeconds);
  const validDelta = Number.isFinite(delta) && delta !== 0;
  const newEta =
    featuredUntil && validDelta
      ? new Date(new Date(featuredUntil).getTime() + delta * 1000)
      : null;

  async function submit() {
    if (!validDelta || !reason.trim()) {
      setError('Delta (non-zero) and reason are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = getAdminToken();
      const res = await fetch(
        `${API_URL}/admin/featured/slots/${slotId}/shift-until`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deltaSeconds: delta,
            reason: reason.trim(),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setOpen(false);
      setDeltaSeconds('0');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shift failed');
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
        Shift featured until
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
              Shift Slot #{slotNumber} end time
            </h3>
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Currently ends:{' '}
              <span style={{ color: 'var(--text-primary)' }}>
                {featuredUntil
                  ? new Date(featuredUntil).toLocaleString('en-ZA')
                  : '—'}
              </span>
            </p>
            <p
              className="text-xs mb-4"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Positive = extend, negative = shorten. 86400 = +24h, -3600 = -1h.
            </p>

            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Delta (seconds)
            </label>
            <input
              type="number"
              value={deltaSeconds}
              onChange={(e) => setDeltaSeconds(e.target.value)}
              className="w-full px-3 py-2 rounded-[6px] text-sm mb-2"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
              autoFocus
            />

            {newEta && (
              <p
                className="text-xs mb-3"
                style={{ color: 'var(--text-secondary)' }}
              >
                New end time:{' '}
                <span style={{ color: 'var(--text-primary)' }}>
                  {newEta.toLocaleString('en-ZA')}
                </span>
              </p>
            )}

            <label
              className="text-xs mb-1 block mt-2"
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
                disabled={busy || !validDelta || !reason.trim()}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                style={{
                  background:
                    busy || !validDelta || !reason.trim()
                      ? 'var(--bg-inset)'
                      : 'var(--red)',
                  color:
                    busy || !validDelta || !reason.trim()
                      ? 'var(--text-tertiary)'
                      : '#fff',
                  border:
                    busy || !validDelta || !reason.trim()
                      ? '0.5px solid var(--border)'
                      : 'none',
                  cursor:
                    busy || !validDelta || !reason.trim()
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {busy ? 'Shifting…' : 'Shift end time'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
