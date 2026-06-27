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
// Every action that touches money requires explicit confirmation +
// (for refund and dispute resolution) a reason. The reason is recorded
// in the AdminAuditEvent table so an admin reviewing later can see
// exactly why this admin made this call.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

type Action =
  | { kind: 'release' }
  | { kind: 'refund' }
  | { kind: 'dispute-release' }
  | { kind: 'dispute-refund' };

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

  const remainingCents = Math.max(0, buyerTotal - refundedAmount);
  const isRefundAction =
    action?.kind === 'refund' || action?.kind === 'dispute-refund';
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
  const canSubmit =
    action !== null && reasonOk && (!isRefundAction || amountValid) && !busy;

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
            : `/admin/transactions/${txId}/refund`; // covers both refund + dispute-refund

      const body =
        action.kind === 'release'
          ? undefined
          : action.kind === 'dispute-release'
            ? JSON.stringify({ reason: reason.trim() })
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
      </div>

      {action && (
        <div
          onClick={() => !busy && setAction(null)}
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
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: `0.5px solid ${
                action.kind === 'release' || action.kind === 'dispute-release'
                  ? '#22c55e'
                  : 'var(--red)'
              }`,
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
                onClick={() => setAction(null)}
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
                type="button"
                onClick={execute}
                disabled={!canSubmit}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: canSubmit
                    ? action.kind === 'release' || action.kind === 'dispute-release'
                      ? '#22c55e'
                      : 'var(--red)'
                    : 'var(--bg-inset)',
                  color: canSubmit ? '#fff' : 'var(--text-tertiary)',
                  border: 'none',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
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
  tone: 'success' | 'danger';
  onClick: () => void;
}) {
  const color = tone === 'success' ? '#22c55e' : 'var(--red)';
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
