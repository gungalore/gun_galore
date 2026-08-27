'use client';

// M26 (FLOW-F4) — admin payout-HOLD lever. The only control between a
// PRIVATE_ARRANGE immediate release (HELD->RELEASED at payment, no delivery
// gate) and the daily FNB bulk-payment sweep. While a RELEASED/REFUNDED payout
// is still DUE (not frozen into a bank batch, not yet paid) an admin can HOLD
// it to withhold it from the sweep — buying time to refund or dispute after
// release — or RELEASE an existing hold back into the queue. Self-contained so
// it never touches the release/refund/dispute modal machinery in
// dossier-actions.tsx.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

interface Props {
  txId: string;
  paymentStatus: string;
  payoutHeldAt?: string | null;
  payoutHoldReason?: string | null;
  // true once the payout is committed to a bank batch or already paid out —
  // the hold lever is gone at that point (money committed/gone).
  payoutSettled?: boolean;
}

export default function PayoutHoldPanel({
  txId,
  paymentStatus,
  payoutHeldAt = null,
  payoutHoldReason = null,
  payoutSettled = false,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'hold' | 'release' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a RELEASED/REFUNDED payout that is still due can be held/unheld.
  const isDue = paymentStatus === 'RELEASED' || paymentStatus === 'REFUNDED';
  if (!isDue || payoutSettled) return null;

  const isHeld = !!payoutHeldAt;
  const reasonOk = reason.trim().length >= 5;

  async function submit() {
    if (!mode || !reasonOk) return;
    setBusy(true);
    setError(null);
    try {
      const path =
        mode === 'hold'
          ? `/admin/transactions/${txId}/hold-payout`
          : `/admin/transactions/${txId}/release-payout-hold`;
      const res = await adminFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? `Error ${res.status}`);
      }
      setMode(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: '0.5px solid var(--border)' }}
    >
      <div className="flex gap-2 flex-wrap items-center">
        {isHeld && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{
              background: 'var(--gold-wash)',
              color: 'var(--warning)',
              fontWeight: 500,
            }}
          >
            Payout on hold — excluded from the bank batch
          </span>
        )}
        {!isHeld && (
          <button
            type="button"
            onClick={() => {
              setMode('hold');
              setReason('');
              setError(null);
            }}
            className="text-xs px-3 py-1.5 rounded-[6px]"
            style={{
              background: '#c8102e14',
              color: 'var(--red)',
              border: '0.5px solid var(--red)',
            }}
          >
            Hold payout
          </button>
        )}
        {isHeld && (
          <button
            type="button"
            onClick={() => {
              setMode('release');
              setReason('');
              setError(null);
            }}
            className="text-xs px-3 py-1.5 rounded-[6px]"
            style={{
              background: '#22c55e14',
              color: '#22c55e',
              border: '0.5px solid #22c55e',
            }}
          >
            Release hold
          </button>
        )}
      </div>

      {isHeld && payoutHoldReason && !mode && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          Hold reason: {payoutHoldReason}
        </p>
      )}

      {mode && (
        <div className="mt-3 space-y-2">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {mode === 'hold'
              ? 'Withholds this already-released payout from the daily bank batch until you release the hold — use it if fraud is alleged after release. Money stays with All Outdoor. Reason recorded in the audit log.'
              : 'Returns this payout to the due queue; it will be included in the next daily bank batch. Reason recorded in the audit log.'}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (min 5 characters) — recorded in the audit log"
            rows={2}
            className="w-full text-xs rounded-[6px] p-2"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!reasonOk || busy}
              onClick={submit}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{
                background: !reasonOk || busy ? 'var(--bg-inset)' : 'var(--red)',
                color: !reasonOk || busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: !reasonOk || busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy
                ? 'Working…'
                : mode === 'hold'
                  ? 'Confirm hold'
                  : 'Confirm release'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setReason('');
                setError(null);
              }}
              className="text-xs px-3 py-1.5 rounded-[6px]"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: 'none' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
