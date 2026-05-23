'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function getAdminToken(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('gg_admin_sess='))
      ?.split('=')[1] ?? ''
  );
}

// Manual award skips the auction + bid flow and gives a slot to a
// listing for free. Use case: comping a promised slot after a botched
// auction, or seeding a new slot. Backend does its own validation
// (listing must be ACTIVE, seller not banned, etc.).
export function ManualAwardButton({
  slotId,
  slotNumber,
}: {
  slotId: string;
  slotNumber: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listingId, setListingId] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('86400');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!listingId.trim() || !reason.trim()) {
      setError('Listing reference and reason are required');
      return;
    }
    const seconds = Number(durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setError('Duration must be a positive number of seconds');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = getAdminToken();
      const res = await fetch(
        `${API_URL}/admin/featured/slots/${slotId}/manual-award`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            listingId: listingId.trim(),
            durationSeconds: seconds,
            reason: reason.trim(),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setOpen(false);
      setListingId('');
      setDurationSeconds('86400');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manual award failed');
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
          border: '0.5px solid var(--red)',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Manual award
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
              Manual award Slot #{slotNumber}
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)' }}
            >
              Award this slot to a listing for free. Slot must currently be
              vacant or running an auction (the auction will be cancelled).
            </p>

            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Listing reference
            </label>
            <input
              type="text"
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              placeholder="e.g. UM000123, AU000045, TS000007"
              className="w-full px-3 py-2 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}
              autoFocus
            />
            <p
              className="text-[11px] mt-1 mb-3"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
            >
              The reference number from the top of the listing page (UM
              = Marketplace, AU = Auction, TS = Take a Shot). Internal
              CUIDs are also accepted.
            </p>

            <label
              className="text-xs mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Duration (seconds) — 86400 = 24h, 259200 = 3d, 604800 = 7d
            </label>
            <input
              type="number"
              min={1}
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
              className="w-full px-3 py-2 rounded-[6px] text-sm mb-3"
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />

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
                disabled={busy}
                className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
                style={{
                  background: busy ? 'var(--bg-inset)' : 'var(--red)',
                  color: busy ? 'var(--text-tertiary)' : '#fff',
                  border: busy ? '0.5px solid var(--border)' : 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Awarding…' : 'Award slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
