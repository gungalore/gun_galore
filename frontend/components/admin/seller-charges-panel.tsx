'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReasonDialog } from '@/components/admin/admin-confirm';
import { useAdminToast } from '@/components/admin/admin-ui';
import {
  formatRandExact,
  formatWhen,
  sellerCharges,
  waiveSellerCharge,
  type SellerCharges,
  type SellerChargeRow,
} from '@/lib/admin-api';

const KIND_LABEL: Record<SellerChargeRow['kind'], string> = {
  SELLER_CANCELLED: 'Seller cancelled',
  NO_DISPATCH: 'Never dispatched',
  NOT_DELIVERED: 'Never delivered',
  DEALER_TRANSFER_FAILED: 'Dealer transfer failed',
};

/**
 * What this seller owes us because a paid sale ended through their failure.
 *
 * The charge is recovered from a later payout, so this panel is the only place
 * an admin can see the outstanding balance, what has been settled, and waive a
 * charge (the credit path when a Bob Go waybill is reclaimed by hand).
 */
export function SellerChargesPanel({ userId }: { userId: string }) {
  const { toast } = useAdminToast();
  const [data, setData] = useState<SellerCharges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiving, setWaiving] = useState<SellerChargeRow | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await sellerCharges(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load charges');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <p className="adm-sub">{error}</p>;
  }
  if (!data) {
    return <p className="adm-sub">Loading charges…</p>;
  }
  if (data.charges.length === 0) {
    return (
      <p className="adm-sub" style={{ margin: 0 }}>
        No failure charges on this seller.
      </p>
    );
  }

  return (
    <>
      <p className="adm-sub" style={{ marginTop: 0 }}>
        Outstanding:{' '}
        <strong>{formatRandExact(data.outstandingCents)}</strong> — recovered
        from the seller&apos;s next payout.
      </p>
      {data.charges.map((c) => {
        const recovered = c.recoveries
          .filter((r) => r.status !== 'RELEASED')
          .reduce((s, r) => s + r.amountCents, 0);
        return (
          <div
            key={c.id}
            className="adm-row"
            style={{ cursor: 'default', alignItems: 'flex-start' }}
          >
            <span className="adm-row-text">
              <span className="adm-row-title">
                {formatRandExact(c.amountCents)} — {KIND_LABEL[c.kind]}
              </span>
              <span className="adm-row-caption">
                {c.reason ?? 'No note'} · recovered{' '}
                {formatRandExact(recovered)} of{' '}
                {formatRandExact(c.amountCents)} · {formatWhen(c.createdAt)}
                {c.waivedAt ? ` · waived ${formatWhen(c.waivedAt)}` : ''}
              </span>
            </span>
            {!c.waivedAt ? (
              <button
                type="button"
                className="adm-btn"
                data-tone="ghost"
                onClick={() => setWaiving(c)}
              >
                Waive
              </button>
            ) : null}
          </div>
        );
      })}

      <ReasonDialog
        open={waiving !== null}
        title="Waive this failure charge?"
        body="Use this when the seller was not at fault, or when the committed Bob Go charge was reclaimed by hand. Any part already withheld from a payout must be credited separately."
        confirmLabel="Waive charge"
        danger
        minLength={3}
        onClose={() => setWaiving(null)}
        onConfirm={async (reason) => {
          if (!waiving) return;
          await waiveSellerCharge(waiving.id, reason);
          toast('Charge waived.');
          setWaiving(null);
          await load();
        }}
      />
    </>
  );
}
