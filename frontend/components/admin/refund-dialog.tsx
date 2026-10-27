'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatRandExact, adminFetch, type TransactionRow } from '@/lib/admin-api';

const CHARGE_KINDS = [
  { value: 'SELLER_CANCELLED', label: 'Seller declined or cancelled the sale' },
  { value: 'NO_DISPATCH', label: 'Seller never dispatched' },
  { value: 'NOT_DELIVERED', label: 'Item never delivered' },
  { value: 'DEALER_TRANSFER_FAILED', label: 'Dealer transfer was never completed' },
] as const;

type ChargeKind = (typeof CHARGE_KINDS)[number]['value'];

/**
 * Refund the buyer — with the amount in the admin's hands and, where the
 * failure is the seller's, the cost recovery attached in the same action.
 *
 * The refund API has always accepted a partial amount; this dialog is what
 * finally exposes it. The seller charge follows the amount actually refunded
 * (4% of the cumulative refund) plus a committed courier waybill, so a partial
 * refund can never over-recover.
 */
export function RefundDialog({
  open,
  row,
  onClose,
  onDone,
}: {
  open: boolean;
  row: TransactionRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const buyerTotal = Number(row?.buyerTotal ?? 0);
  const alreadyRefunded = Number(row?.refundedAmount ?? 0);
  const platformFeeKept =
    row?.shippingMethod === 'PRIVATE_ARRANGE'
      ? Number(row?.processingFee ?? 0)
      : 0;
  const remaining = Math.max(
    0,
    buyerTotal - platformFeeKept - alreadyRefunded,
  );

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [chargeSeller, setChargeSeller] = useState(false);
  const [chargeKind, setChargeKind] =
    useState<ChargeKind>('NOT_DELIVERED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount((remaining / 100).toFixed(2));
    setNote('');
    setChargeSeller(false);
    setChargeKind('NOT_DELIVERED');
    setBusy(false);
    setError(null);
  }, [open, remaining]);

  const amountCents = Math.round(Number(amount || '0') * 100);
  const amountOk =
    Number.isFinite(amountCents) &&
    amountCents > 0 &&
    amountCents <= remaining;
  const reasonOk = note.trim().length >= 3;

  const committedShipping =
    chargeSeller && row?.carrierShipmentId
      ? Math.max(0, Number(row?.shippingCost ?? 0))
      : 0;
  const chargePreview = useMemo(() => {
    if (!chargeSeller) return 0;
    const handling = Math.round(
      (alreadyRefunded + Math.max(0, amountCents)) * 0.04,
    );
    return handling + committedShipping;
  }, [chargeSeller, alreadyRefunded, amountCents, committedShipping]);

  if (!open) return null;

  async function submit() {
    if (!amountOk || !reasonOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/transactions/${row?.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          note: note.trim(),
          amountZarCents: amountCents,
          chargeSeller,
          ...(chargeSeller ? { chargeKind } : {}),
        }),
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
      setBusy(false);
    }
  }

  return (
    <div
      className="adm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{ alignItems: 'center', padding: 20 }}
    >
      <div
        className="adm-card"
        data-tone="red"
        role="dialog"
        aria-modal="true"
        aria-label="Refund the buyer"
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#090e13',
          borderRadius: 18,
        }}
      >
        <div className="adm-card-head">
          <span className="adm-card-title">Refund the buyer</span>
        </div>
        <p className="adm-sub">
          Refundable now: <strong>{formatRandExact(remaining)}</strong>
          {platformFeeKept > 0
            ? ' (the Platform Fee is non-refundable on an in-person handover)'
            : ''}
          . The gateway refund runs first, then the ledger is marked.
        </p>

        <label className="adm-label" htmlFor="refund-amount">
          Amount (R)
        </label>
        <input
          id="refund-amount"
          className="adm-input"
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
        {!amountOk ? (
          <p className="adm-sub" style={{ color: 'var(--adm-red)' }}>
            Enter an amount between R0.01 and {formatRandExact(remaining)}.
          </p>
        ) : null}

        <label
          className="adm-label"
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}
        >
          <input
            type="checkbox"
            checked={chargeSeller}
            onChange={(e) => setChargeSeller(e.target.checked)}
            disabled={busy}
          />
          Recover our costs from the seller
        </label>
        {chargeSeller ? (
          <>
            <select
              className="adm-select"
              value={chargeKind}
              onChange={(e) => setChargeKind(e.target.value as ChargeKind)}
              disabled={busy}
            >
              {CHARGE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <p className="adm-sub" style={{ marginTop: 8 }}>
              4% of the cumulative refund + committed courier ={' '}
              <strong>{formatRandExact(chargePreview)}</strong>, set off
              against the seller&apos;s next payout.
            </p>
          </>
        ) : null}

        <label className="adm-label" htmlFor="refund-note">
          Reason (required)
        </label>
        <textarea
          id="refund-note"
          className="adm-textarea"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />

        {error ? (
          <p className="adm-sub" style={{ color: 'var(--adm-red)' }}>
            {error}
          </p>
        ) : null}

        <div className="adm-grid-2" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="red"
            onClick={submit}
            disabled={busy || !amountOk || !reasonOk}
          >
            {busy ? 'Refunding…' : 'Refund buyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
