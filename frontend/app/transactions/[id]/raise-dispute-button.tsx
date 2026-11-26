'use client';

// Buyer-facing NON-DELIVERY dispute flow. A dispute exists for one situation
// only: the item never arrived / was never handed over. The modal carries:
//   1. A fixed reason (NEVER_ARRIVED — the backend enum value)
//   2. Free-text details (min 10 chars — backend enforces)
//
// Condition, description, damage after delivery and change of mind are NOT
// dispute grounds and carry no platform refund: those are between the buyer
// and the seller (message the seller from this order, or lodge a complaint).
// That is why there is no reason picker any more — a dispute that is not about
// non-delivery is the wrong route by definition.
//
// On submit: POST /transactions/:id/dispute, then a success step (NOT an
// immediate refresh — the refresh flips the order to DISPUTED, which unmounts
// this whole block and would rip the success step off the screen). The success
// step tells the buyer we will review the tracking; there is no item to
// photograph here, so it no longer hands them the complaints evidence route.
// Closing the success step refreshes the tx page so the "Disputed" banner
// takes over.
//
// Used in two places:
//   - Directly on the transaction page (primary call site)
//   - From inside ConfirmDeliveryButton's modal as the "item never arrived"
//     escape hatch
//
// Exported `RaiseDisputeModal` so the escape hatch can mount it without
// re-rendering the full button card.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// The only reason this form can submit. The backend still takes a reason
// string, but the buyer no longer picks one: non-delivery is the only
// platform-handled dispute.
const DISPUTE_REASON = 'NEVER_ARRIVED';

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
          color: 'var(--danger-edge)',
          border: '1.5px solid var(--danger-edge)',
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
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dispute accepted by the backend. Holds the modal open on a success step
  // instead of vanishing silently — that silence was the whole complaint:
  // no reference, no next step, no idea it worked.
  const [submitted, setSubmitted] = useState(false);

  const detailsOk = details.trim().length >= 10;
  const canSubmit = detailsOk && !busy;

  // Dismissing AFTER a successful submit is what refreshes the tx page, so
  // the "Disputed" banner replaces the action buttons. Refreshing earlier
  // unmounts this modal mid-success-step (the buttons gate on HELD).
  function dismiss() {
    if (submitted) {
      onDone();
      router.refresh();
      return;
    }
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!detailsOk) return;
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
        body: JSON.stringify({ reason: DISPUTE_REASON, details: details.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise dispute');
    } finally {
      setBusy(false);
    }
  }

  // Shared by the form and the success step so the panel doesn't visibly
  // resize/re-skin between them.
  const panelStyle = {
    maxWidth: 520,
    width: '100%',
    padding: 24,
    borderRadius: 10,
    background: 'var(--bg-card)',
    border: '0.5px solid var(--red)',
  } as const;

  if (submitted) {
    return (
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          // ≥ 60: the installed-app bottom tab bar sits at 55 and its sheets
          // at 56, so anything lower renders underneath them on mobile.
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div onClick={(e) => e.stopPropagation()} style={panelStyle} role="status">
          <p
            className="text-base mb-2"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Dispute logged
          </p>
          <p
            className="text-sm mb-3"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            Your payment stays held while our team reviews the tracking.
            Don&apos;t confirm delivery in the meantime — that releases the
            seller&apos;s payout.
          </p>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            If the item has not arrived, we will review the tracking and
            contact you. You do not need to do anything else.
          </p>
          <p
            className="text-xs mb-4"
            style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
          >
            If you need to reach the seller about anything else, message them
            from this order page.
          </p>

          <button
            type="button"
            onClick={dismiss}
            className="w-full py-2 rounded text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-visible)',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={dismiss}
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
        style={panelStyle}
      >
        <p
          className="text-base mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Raise a dispute — item never arrived
        </p>
        <p
          className="text-sm mb-2"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          A dispute is only for an item that has not arrived. Your payment
          stays held while our team reviews the tracking, and we will contact
          you within 48 hours.
        </p>
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
        >
          Condition, description, damage after delivery or change of mind are
          between you and the seller — message the seller from this order or
          lodge a complaint. They are not grounds for a dispute or a refund
          here.
        </p>

        {/* Replaces the old 4-reason radio picker: there is exactly one
            platform-handled reason, shown here rather than chosen. */}
        <div
          className="rounded-[6px] px-3 py-2.5 mb-4"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="text-xs uppercase tracking-wider mb-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Reason
          </p>
          <p
            className="text-sm"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Item never arrived / was not handed over
          </p>
        </div>

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
            placeholder="Tell us what you bought and what has not arrived — the dispatch date, tracking reference, and any dates you contacted the seller."
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{
              background: 'var(--field-bg)',
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
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            There is no item to photograph — we will check the tracking with
            the seller and the courier.
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
            onClick={dismiss}
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
              background: canSubmit
                ? 'var(--danger-fill)'
                : 'var(--bg-inset)',
              color: canSubmit ? 'var(--danger-ink)' : 'var(--text-tertiary)',
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
