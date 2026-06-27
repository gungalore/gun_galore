'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const REASONS: { value: string; label: string }[] = [
  { value: 'Changed my mind', label: 'Changed my mind' },
  { value: 'Found a better option', label: 'Found a better option' },
  { value: 'Seller communication issue', label: 'Seller not responding' },
  { value: 'Ordered by mistake', label: 'Ordered by mistake' },
  { value: 'other', label: 'Other (explain)' },
];

// Buyer-initiated cancellation of a paid-but-undispatched courier order
// (Phase 4 P4.2). Reason required; POSTs to /transactions/:id/cancel which
// full-refunds + reactivates the listing. Only rendered when the order is
// actually cancellable (gates computed by the parent page).
export default function BuyerCancelPanel({
  txId,
  buyerTotalRand,
}: {
  txId: string;
  buyerTotalRand: string;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(REASONS[0].value);
  const [otherText, setOtherText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = choice === 'other' ? otherText.trim() : choice;
  const reasonOk = reason.length >= 3;

  async function submit() {
    if (!reasonOk) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${txId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? `Error ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
          Need to cancel?
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">
          This item hasn&apos;t been dispatched yet. You can cancel now for a
          full refund of {buyerTotalRand} (3–7 working days back to your card).
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm px-3 py-1.5 rounded-md border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)]/10"
        >
          Cancel order &amp; request refund
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--red)] p-4">
      <p className="text-sm font-medium text-[var(--text-primary)] mb-2">
        Cancel this order?
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        We&apos;ll refund {buyerTotalRand} to your card and put the item back on
        the marketplace. Tell us why:
      </p>
      <div className="space-y-1.5 mb-3">
        {REASONS.map((r) => (
          <label
            key={r.value}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer"
          >
            <input
              type="radio"
              name="cancel-reason"
              value={r.value}
              checked={choice === r.value}
              onChange={() => setChoice(r.value)}
            />
            {r.label}
          </label>
        ))}
      </div>
      {choice === 'other' && (
        <textarea
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
          rows={2}
          placeholder="Briefly explain (min 3 characters)"
          className="w-full px-3 py-2 mb-3 rounded text-sm bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
        />
      )}
      {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="flex-1 py-2 rounded text-sm border border-[var(--border)] text-[var(--text-secondary)]"
        >
          Keep order
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!reasonOk || busy}
          className="flex-1 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          {busy ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
      </div>
    </div>
  );
}
