'use client';

// Action surface in the admin transaction dossier header. Shows
// different controls based on paymentStatus:
//   - PENDING_ADMIN_VERIFICATION  → Release / Refund
//   - HELD                        → Refund (release happens via buyer
//                                   confirming delivery; admin force-
//                                   release only via dispute resolution)
//   - DISPUTED                    → Resolve: release to seller / Refund
//                                   to buyer  (both require reason ≥5
//                                   chars for the audit log)
//   - RELEASED / REFUNDED         → Already resolved, no actions
//
// Independent of paymentStatus, for as long as the sale is still live,
// "Shipment failed" records WHY a courier booking came to nothing. The
// ticklist is fetched from GET /shipping/failure-reasons and never kept
// here — that endpoint also says which reasons bill the seller, so this
// UI cannot drift from the policy that moves the money. Reasons that
// charge are marked in the picker and need a separate tick before the
// confirm button will fire. Not offered once the payment is resolved:
// the charge is deducted where the payout is computed, so recording one
// against an already-released payout would bill nobody.
//
// Every action that touches money requires explicit confirmation +
// (for refund and dispute resolution) a reason. The reason is recorded
// in the AdminAuditEvent table so an admin reviewing later can see
// exactly why this admin made this call.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

type Action =
  | { kind: 'release' }
  | { kind: 'refund' }
  | { kind: 'dispute-release' }
  | { kind: 'dispute-refund' }
  | { kind: 'shipment-failure' };

// GET /shipping/failure-reasons — the policy's own ticklist. `sellerPays`
// is what tells the picker which reasons cost the seller money.
interface FailureReasonOption {
  value: string;
  label: string;
  sellerPays: boolean;
}

interface Props {
  txId: string;
  paymentStatus: string;
  buyerTotal: number;
  refundedAmount?: number;
}

export default function DossierActions({
  txId,
  paymentStatus,
  buyerTotal,
  refundedAmount = 0,
}: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  // Optional partial-refund amount in RANDS (blank = full remaining balance).
  const [amountRands, setAmountRands] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shipment-failure picker: the ticklist from the API (null = not loaded
  // yet), the picked reason, its optional note, the explicit tick an admin
  // must give before a charging reason can be submitted, and the outcome
  // the backend reported so it can be shown instead of vanishing.
  const [failureReasons, setFailureReasons] = useState<
    FailureReasonOption[] | null
  >(null);
  const [reasonsError, setReasonsError] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState('');
  const [note, setNote] = useState('');
  const [chargeAck, setChargeAck] = useState(false);
  const [failureResult, setFailureResult] = useState<{
    charged: boolean;
    chargeCents: number;
  } | null>(null);

  // Load the ticklist the first time the picker is opened. Deliberately
  // not hard-coded: the same list is what the backend validates against.
  useEffect(() => {
    if (action?.kind !== 'shipment-failure' || failureReasons !== null) return;
    let cancelled = false;
    setReasonsError(null);
    adminFetch('/shipping/failure-reasons')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return (await res.json()) as FailureReasonOption[];
      })
      .then((list) => {
        if (!Array.isArray(list)) throw new Error('Unexpected response');
        if (!cancelled) setFailureReasons(list);
      })
      .catch(() => {
        if (!cancelled) {
          setReasonsError(
            "Couldn't load the failure reasons — nothing has been recorded. Close this and try again.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [action, failureReasons]);

  const remainingCents = Math.max(0, buyerTotal - refundedAmount);
  const isRefundAction =
    action?.kind === 'refund' || action?.kind === 'dispute-refund';
  const isShipmentFailure = action?.kind === 'shipment-failure';
  const pickedReason =
    failureReasons?.find((r) => r.value === failureReason) ?? null;
  // Parse the Rands input → cents. Empty string => full refund (undefined).
  const parsedAmountCents =
    amountRands.trim() === ''
      ? undefined
      : Math.round(parseFloat(amountRands) * 100);
  const amountValid =
    parsedAmountCents === undefined ||
    (Number.isFinite(parsedAmountCents) &&
      parsedAmountCents >= 100 &&
      parsedAmountCents <= remainingCents);

  const isPending = paymentStatus === 'PENDING_ADMIN_VERIFICATION';
  const isHeld = paymentStatus === 'HELD';
  const isDisputed = paymentStatus === 'DISPUTED';
  const isResolved = paymentStatus === 'RELEASED' || paymentStatus === 'REFUNDED';

  if (isResolved) {
    return (
      <span
        className="text-xs px-2 py-1 rounded-full"
        style={{
          background: paymentStatus === 'RELEASED' ? '#22c55e18' : '#6366f118',
          color: paymentStatus === 'RELEASED' ? '#22c55e' : '#6366f1',
        }}
      >
        Resolved · {paymentStatus.toLowerCase()}
      </span>
    );
  }

  const requiresReason =
    action?.kind === 'refund' ||
    action?.kind === 'dispute-release' ||
    action?.kind === 'dispute-refund';
  const reasonOk = !requiresReason || reason.trim().length >= 5;
  // A failure needs a reason off the list, and a reason that bills the
  // seller needs the charge ticked as well — so nobody is billed by a
  // stray click on a radio button.
  const failureOk =
    !isShipmentFailure ||
    (pickedReason !== null && (!pickedReason.sellerPays || chargeAck));
  // The outcome panel belongs to the failure modal only — a leftover
  // result must never change how the refund modal behaves.
  const showFailureResult = isShipmentFailure && failureResult !== null;
  const canSubmit =
    action !== null &&
    reasonOk &&
    (!isRefundAction || amountValid) &&
    failureOk &&
    !showFailureResult &&
    !busy;
  // Green for the two release outcomes, red for anything that takes money
  // off someone. A failure only takes money when the picked reason charges,
  // so it sits at amber until it does.
  const accent =
    action?.kind === 'release' || action?.kind === 'dispute-release'
      ? '#22c55e'
      : isShipmentFailure && !pickedReason?.sellerPays
        ? 'var(--amber, #f59e0b)'
        : 'var(--red)';

  // Shared by the overlay and the Cancel/Close button. Closing a recorded
  // failure is also when the dossier is refreshed, so the page picks it up.
  function dismiss() {
    if (busy) return;
    setAction(null);
    if (showFailureResult) {
      setFailureResult(null);
      router.refresh();
    }
  }

  async function execute() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const path =
        action.kind === 'release'
          ? `/admin/transactions/${txId}/release`
          : action.kind === 'dispute-release'
            ? `/admin/transactions/${txId}/resolve-dispute-release`
            : action.kind === 'shipment-failure'
              ? `/admin/transactions/${txId}/shipment-failure`
              : `/admin/transactions/${txId}/refund`; // covers both refund + dispute-refund

      const body =
        action.kind === 'release'
          ? undefined
          : action.kind === 'dispute-release'
            ? JSON.stringify({ reason: reason.trim() })
            : action.kind === 'shipment-failure'
              ? JSON.stringify({
                  reason: failureReason,
                  // Optional — left out entirely rather than sent blank.
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              : JSON.stringify({
                  note: reason.trim(),
                  // Partial refund: only sent when the admin typed an amount;
                  // omitted => backend refunds the full remaining balance.
                  ...(parsedAmountCents !== undefined
                    ? { amountZarCents: parsedAmountCents }
                    : {}),
                });

      const res = await adminFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      if (action.kind === 'shipment-failure') {
        // Stays open on purpose: an admin who may have just docked a
        // seller has to see what was recorded and how much, not a modal
        // that disappears. The backend is the one that decides whether
        // this reason charged, so the answer comes from its response.
        const out = (await res.json().catch(() => ({}))) as {
          charged?: boolean;
          chargeCents?: number;
        };
        setFailureResult({
          charged: !!out.charged,
          chargeCents: out.chargeCents ?? 0,
        });
        return;
      }
      setAction(null);
      setReason('');
      setAmountRands('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const TITLE: Record<Action['kind'], string> = {
    release: 'Release payout to seller?',
    refund: 'Refund buyer?',
    'dispute-release': 'Resolve dispute — release to seller?',
    'dispute-refund': 'Resolve dispute — refund buyer?',
    'shipment-failure': 'Record a failed courier shipment',
  };

  const SUBTITLE: Record<Action['kind'], string> = {
    release:
      'Payment moves to RELEASED, seller payout is initiated. Hard-gated on seller KYC + bank verification + profile completion — backend rejects if any are missing.',
    refund:
      'The amount below is sent back to the buyer via the payment gateway. A full refund moves the order to REFUNDED; a partial refund keeps it open so the balance can still be released or refunded later. Reversible only by manual gateway intervention.',
    'dispute-release':
      'You have investigated and found in favour of the seller. Payment moves to RELEASED, seller payout is initiated, dispute alert closes. The reason below is recorded in the audit log and visible to the buyer.',
    'dispute-refund':
      'You have investigated and found in favour of the buyer. Payment moves to REFUNDED, full amount goes back to the buyer, dispute alert closes. Reason recorded in the audit log and visible to the seller.',
    'shipment-failure':
      'Say what went wrong with the courier booking. The carrier tells us that a collection or delivery failed, not whose fault it was — that call is yours and it is recorded in the audit log. Reasons marked “Seller pays” bill the seller the wasted courier cost for this booking, deducted from their payout for this sale.',
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {isPending && (
          <>
            <ActionButton
              label="Release"
              tone="success"
              onClick={() => setAction({ kind: 'release' })}
            />
            <ActionButton
              label="Refund"
              tone="danger"
              onClick={() => setAction({ kind: 'refund' })}
            />
          </>
        )}
        {isHeld && (
          <>
            <ActionButton
              label="Refund"
              tone="danger"
              onClick={() => setAction({ kind: 'refund' })}
            />
            <span
              className="text-xs px-2 py-1 rounded-full self-center"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
            >
              Buyer must confirm delivery to release
            </span>
          </>
        )}
        {isDisputed && (
          <>
            <span
              className="text-xs px-2 py-1 rounded-full self-center"
              style={{ background: 'var(--red)18', color: 'var(--red)', fontWeight: 500 }}
            >
              DISPUTED — resolve
            </span>
            <ActionButton
              label="Release to seller"
              tone="success"
              onClick={() => setAction({ kind: 'dispute-release' })}
            />
            <ActionButton
              label="Refund buyer"
              tone="danger"
              onClick={() => setAction({ kind: 'dispute-refund' })}
            />
          </>
        )}
        {/* A courier booking can fail at any point while the sale is live,
            so this one is not tied to a paymentStatus like the money
            actions above. Opening it clears whatever a previous action
            left behind — a stale reason must never become a note. */}
        <ActionButton
          label="Shipment failed"
          tone="warn"
          onClick={() => {
            setFailureReason('');
            setNote('');
            setChargeAck(false);
            setFailureResult(null);
            setError(null);
            setAction({ kind: 'shipment-failure' });
          }}
        />
      </div>

      {action && (
        <div
          onClick={dismiss}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 520,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: `0.5px solid ${accent}`,
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {TITLE[action.kind]}
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              {SUBTITLE[action.kind]}
            </p>

            {isRefundAction && (
              <div className="mb-4">
                <label
                  className="text-xs uppercase tracking-wider mb-1 block"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Refund amount (Rands) — leave blank for full
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={amountRands}
                  onChange={(e) => setAmountRands(e.target.value)}
                  placeholder={`Full balance: R${(remainingCents / 100).toFixed(2)}`}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{
                    background: 'var(--bg-inset)',
                    border: `0.5px solid ${amountValid ? 'var(--border)' : 'var(--red)'}`,
                    color: 'var(--text-primary)',
                  }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {refundedAmount > 0
                    ? `Already refunded R${(refundedAmount / 100).toFixed(2)} of R${(buyerTotal / 100).toFixed(2)}. Remaining R${(remainingCents / 100).toFixed(2)}.`
                    : `Order total R${(buyerTotal / 100).toFixed(2)}. Min R1.00; partial refunds keep the order open.`}
                  {!amountValid && ' — amount must be between R1.00 and the remaining balance.'}
                </p>
              </div>
            )}

            {isShipmentFailure && !failureResult && (
              <>
                {reasonsError && (
                  <p className="text-sm mb-4" style={{ color: 'var(--red)' }}>
                    {reasonsError}
                  </p>
                )}
                {!reasonsError && failureReasons === null && (
                  <p
                    className="text-sm mb-4"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Loading reasons…
                  </p>
                )}
                {failureReasons !== null && (
                  <div
                    className="mb-4 space-y-1"
                    style={{ maxHeight: 260, overflowY: 'auto' }}
                  >
                    {failureReasons.map((r) => {
                      const picked = failureReason === r.value;
                      return (
                        <label
                          key={r.value}
                          className="flex items-start gap-2 px-3 py-2 rounded"
                          style={{
                            background: picked
                              ? 'var(--bg-inset)'
                              : 'transparent',
                            border: `0.5px solid ${
                              picked
                                ? r.sellerPays
                                  ? 'var(--red)'
                                  : 'var(--border)'
                                : 'transparent'
                            }`,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name="shipment-failure-reason"
                            value={r.value}
                            checked={picked}
                            onChange={() => {
                              setFailureReason(r.value);
                              // Ticking the charge for one reason must
                              // never carry over to another.
                              setChargeAck(false);
                            }}
                            style={{ marginTop: 3, cursor: 'pointer' }}
                          />
                          <span
                            className="text-sm"
                            style={{
                              color: 'var(--text-primary)',
                              lineHeight: 1.45,
                            }}
                          >
                            {r.label}
                            {r.sellerPays && (
                              <span
                                className="text-xs ml-2 px-1.5 py-0.5 rounded-full"
                                style={{
                                  color: 'var(--red)',
                                  border: '0.5px solid var(--red)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Seller pays
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="mb-4">
                  <label
                    className="text-xs uppercase tracking-wider mb-1 block"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Note (optional — recorded in the audit log)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    // Backend stores 500 chars — cap here so nothing an
                    // admin typed is silently cut off.
                    maxLength={500}
                    placeholder="What the courier or the seller said — anything that explains this later."
                    className="w-full px-3 py-2 rounded text-sm outline-none"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                      resize: 'vertical',
                    }}
                  />
                </div>

                {/* The deliberate step. Only appears for a reason that
                    actually bills, and says the amount's basis in plain
                    words — the confirm button stays dead until it's ticked. */}
                {pickedReason?.sellerPays && (
                  <label
                    className="flex items-start gap-2 mb-4 px-3 py-2 rounded"
                    style={{
                      background: 'var(--red)18',
                      border: '0.5px solid var(--red)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={chargeAck}
                      onChange={(e) => setChargeAck(e.target.checked)}
                      style={{ marginTop: 3, cursor: 'pointer' }}
                    />
                    <span
                      className="text-xs"
                      style={{
                        color: 'var(--text-primary)',
                        lineHeight: 1.55,
                      }}
                    >
                      I confirm the seller is charged the wasted courier cost
                      for this failed booking, and that it comes off their
                      payout for this sale. Each further failure adds a further
                      charge.
                    </span>
                  </label>
                )}
              </>
            )}

            {showFailureResult && failureResult && (
              <div
                className="mb-4 px-3 py-2 rounded"
                style={{
                  background: failureResult.charged
                    ? 'var(--red)18'
                    : 'var(--bg-inset)',
                  border: `0.5px solid ${
                    failureResult.charged ? 'var(--red)' : 'var(--border)'
                  }`,
                }}
              >
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-primary)', fontWeight: 500 }}
                >
                  {failureResult.charged
                    ? `Recorded — seller charged R${(failureResult.chargeCents / 100).toFixed(2)}`
                    : 'Recorded — no seller charge'}
                </p>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                >
                  {failureResult.charged
                    ? `R${(failureResult.chargeCents / 100).toFixed(2)} for the wasted courier booking is deducted from this seller's payout for this sale. The agreed sale figures are unchanged — the deduction shows as its own line.`
                    : 'The failure is on the transaction record. Nothing is deducted from the seller.'}
                </p>
              </div>
            )}

            {requiresReason && (
              <div className="mb-4">
                <label
                  className="text-xs uppercase tracking-wider mb-1 block"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Reason (recorded in audit log)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Briefly explain — what's the basis for this resolution?"
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{
                    background: 'var(--bg-inset)',
                    border: '0.5px solid var(--border)',
                    color: 'var(--text-primary)',
                    resize: 'vertical',
                  }}
                  autoFocus
                />
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {reason.length}/5 minimum
                </p>
              </div>
            )}

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
                {showFailureResult ? 'Close' : 'Cancel'}
              </button>
              {/* Gone once the failure is recorded — there is nothing left
                  to confirm, and a live Confirm button next to a charge
                  invites recording it twice. */}
              {!showFailureResult && (
                <button
                  type="button"
                  onClick={execute}
                  disabled={!canSubmit}
                  className="flex-1 py-2 rounded text-sm font-medium"
                  style={{
                    background: canSubmit ? accent : 'var(--bg-inset)',
                    color: canSubmit ? '#fff' : 'var(--text-tertiary)',
                    border: 'none',
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                  }}
                >
                  {busy
                    ? 'Working…'
                    : isShipmentFailure && pickedReason?.sellerPays
                      ? 'Record and charge seller'
                      : 'Confirm'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  // 'warn' opens something that MIGHT move money depending on what the
  // admin picks — not the same promise as 'danger', which always does.
  tone: 'success' | 'danger' | 'warn';
  onClick: () => void;
}) {
  const color =
    tone === 'success'
      ? '#22c55e'
      : tone === 'warn'
        ? 'var(--amber, #f59e0b)'
        : 'var(--red)';
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded text-xs font-medium"
      style={{
        background: `${color}18`,
        color,
        border: `0.5px solid ${color}40`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
