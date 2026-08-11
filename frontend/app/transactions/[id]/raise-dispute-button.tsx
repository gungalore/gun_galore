'use client';

// Buyer-facing dispute flow. Opens a modal with:
//   1. Reason picker (radio): damaged / wrong item / never arrived / other
//   2. Free-text details (min 10 chars — backend enforces)
//   3. Consent line: "Admin reviews disputes — release usually within 48h"
//
// On submit: POST /transactions/:id/dispute, then a success step (NOT an
// immediate refresh — the refresh flips the order to DISPUTED, which unmounts
// this whole block and would rip the success step off the screen). The success
// step is where the buyer is handed the evidence route: the complaints module
// (/complaints/new) takes private photos and issues a CO case number, and it
// was previously reachable only from the legal pages. Closing the success step
// refreshes the tx page so the "Disputed" banner takes over.
//
// Used in two places:
//   - Directly on the transaction page (primary call site)
//   - From inside ConfirmDeliveryButton's modal as the "something's
//     wrong" escape hatch (HIGH-4)
//
// Exported `RaiseDisputeModal` so the escape hatch can mount it
// without re-rendering the full button card.

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

// The formal-complaint intake — the ONLY in-app route that takes evidence
// photos (kept private to the user + review team) and issues a CO case
// number. It used to be linked from the legal pages only, so a disputing
// buyer was told to email photos instead. The tx id rides in the query so the
// picker can preselect the order once /complaints/new reads it; it does not
// today, which is why the copy tells the buyer to choose this order.
function complaintHref(transactionId: string) {
  return `/complaints/new?tx=${encodeURIComponent(transactionId)}`;
}

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
  // Dispute accepted by the backend. Holds the modal open on a success step
  // instead of vanishing silently — that silence was the whole complaint:
  // no reference, no evidence route, no idea it worked.
  const [submitted, setSubmitted] = useState(false);

  const detailsOk = details.trim().length >= 10;
  const canSubmit = reason !== null && detailsOk && !busy;

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
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            Your payment stays held while our team reviews it. We&apos;ll
            contact you within 48 hours. Don&apos;t confirm delivery in the
            meantime — that releases the seller&apos;s payout.
          </p>

          {/* The evidence route. Photos decide most of these cases, and the
              complaints module is the only place that takes them (privately)
              and gives the buyer a reference to quote back to us. */}
          <div
            className="rounded-[6px] p-3 mb-4"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
          >
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Have photos of the problem?
            </p>
            <p
              className="text-xs mb-3"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
            >
              Open a formal case to upload them — you get a case reference
              (CO number) to track it, and the photos stay private to you and
              our review team. Pick this order from the list on that page.
            </p>
            <Link
              href={complaintHref(transactionId)}
              className="inline-block py-2 px-3 rounded-[6px] text-sm"
              style={{
                background: 'var(--red)',
                color: '#fff',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Add photos and evidence →
            </Link>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="w-full py-2 rounded text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
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
            placeholder="Describe the issue so the admin team can investigate — what you expected, what arrived, and any serial or model numbers."
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
          {/* Old copy told the buyer to email photos. They upload them in-app
              now — say so here, and again on the success step. */}
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            You&apos;ll be able to upload photos as evidence after you submit.
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

/** Next step for an order already sitting in DISPUTED.
 *
 * The DISPUTED banner on the order page is currently a dead end: "we'll
 * contact you within 48 hours" and nothing to do, no reference, no way to
 * hand us the photos that decide the case. This is that missing step — drop
 * it inside the banner (it's deliberately just a hint line + link so it
 * inherits the banner's own framing):
 *
 *     {isBuyer && <DisputeEvidenceLink transactionId={tx.id} />}
 *
 * Lives here rather than in the page because the complaints URL and its
 * caveat (the picker isn't preselected yet) are owned by this file. */
export function DisputeEvidenceLink({ transactionId }: { transactionId: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        Photos usually settle these faster. Open a formal case to upload them —
        you get a case reference (CO number) and they stay private to you and
        our review team. Pick this order from the list on that page.
      </p>
      <Link
        href={complaintHref(transactionId)}
        className="inline-block py-2 px-3 rounded-[6px] text-sm"
        style={{
          background: 'var(--bg-card)',
          color: 'var(--red)',
          border: '0.5px solid var(--red)',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Add photos and details to your case →
      </Link>
    </div>
  );
}
