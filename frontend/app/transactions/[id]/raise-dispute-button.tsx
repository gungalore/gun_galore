'use client';

// Buyer-facing dispute flow. Opens a modal with:
//   1. Reason picker (radio): damaged / wrong item / never arrived / other
//   2. Free-text details (min 10 chars — backend enforces)
//   3. Consent line: "Admin reviews disputes — release usually within 48h"
//
// On submit: POST /transactions/:id/dispute. On success: the tx page
// re-renders with paymentStatus=DISPUTED (which removes Confirm-Delivery
// + Raise-Dispute and surfaces the new "Disputed" banner).
//
// Used in two places:
//   - Directly on the transaction page (primary call site)
//   - From inside ConfirmDeliveryButton's modal as the "something's
//     wrong" escape hatch (HIGH-4)
//
// Exported `RaiseDisputeModal` so the escape hatch can mount it
// without re-rendering the full button card.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type Reason = 'DAMAGED' | 'WRONG_ITEM' | 'NEVER_ARRIVED' | 'OTHER';

const REASON_OPTIONS: { value: Reason; label: string; hint: string }[] = [
  {
    value: 'DAMAGED',
    label: 'Arrived damaged',
    hint: 'Item is broken, scratched, or otherwise not in the condition described',
  },
  {
    value: 'WRONG_ITEM',
    label: 'Wrong item',
    hint: "What I received isn't what was listed (different model, calibre, etc.)",
  },
  {
    value: 'NEVER_ARRIVED',
    label: 'Never arrived',
    hint: 'Seller marked as dispatched but the parcel never showed up',
  },
  {
    value: 'OTHER',
    label: 'Something else',
    hint: 'Different issue — describe below',
  },
];

export function RaiseDisputeButton({ transactionId }: { transactionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-2.5 rounded-[6px] text-sm"
        style={{
          background: 'transparent',
          color: 'var(--red)',
          border: '0.5px solid var(--red)',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Raise a dispute
      </button>
      {open && (
        <RaiseDisputeModal
          transactionId={transactionId}
          onClose={() => setOpen(false)}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function RaiseDisputeModal({
  transactionId,
  onClose,
  onDone,
}: {
  transactionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsOk = details.trim().length >= 10;
  const canSubmit = reason !== null && detailsOk && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions/${transactionId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason, details: details.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      onDone();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise dispute');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          maxWidth: 520,
          width: '100%',
          padding: 24,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--red)',
        }}
      >
        <p
          className="text-base mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Raise a dispute
        </p>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          Your payment will stay held while the admin team reviews. We'll
          contact you within 48 hours. Don't confirm delivery if you're
          unhappy — that releases the seller's payout immediately.
        </p>

        <fieldset className="space-y-2 mb-4" style={{ border: 'none', padding: 0 }}>
          <legend
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            What's wrong?
          </legend>
          {REASON_OPTIONS.map((opt) => {
            const selected = reason === opt.value;
            return (
              <label
                key={opt.value}
                className="flex items-start gap-3 px-3 py-2.5 rounded-[6px] cursor-pointer"
                style={{
                  background: selected
                    ? 'rgba(200,16,46,0.08)'
                    : 'var(--bg-inset)',
                  border: selected
                    ? '1px solid var(--red)'
                    : '0.5px solid var(--border)',
                }}
              >
                <input
                  type="radio"
                  name="dispute-reason"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setReason(opt.value)}
                  className="mt-1"
                  style={{ accentColor: 'var(--red)' }}
                />
                <span className="flex-1">
                  <span
                    className="block text-sm"
                    style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                  >
                    {opt.label}
                  </span>
                  <span
                    className="block text-xs mt-0.5"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mb-4">
          <label
            className="text-xs uppercase tracking-wider mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            What happened? (min 10 characters)
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="Describe the issue so the admin team can investigate. Include photos in a follow-up email if relevant — admin will reach out."
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{
              background: 'var(--bg-inset)',
              border: `0.5px solid ${
                details.length > 0 && !detailsOk
                  ? 'var(--red)'
                  : 'var(--border)'
              }`,
              color: 'var(--text-primary)',
              resize: 'vertical',
            }}
          />
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {details.length}/10 minimum · {details.length}/1000
          </p>
        </div>

        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm"
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
            type="submit"
            disabled={!canSubmit}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: canSubmit ? 'var(--red)' : 'var(--bg-inset)',
              color: canSubmit ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Submitting…' : 'Raise dispute'}
          </button>
        </div>
      </form>
    </div>
  );
}
