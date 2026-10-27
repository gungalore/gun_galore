'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/admin/admin-confirm';
import { useAdminToast } from '@/components/admin/admin-ui';
import {
  formatWhen,
  removeSellerStrike,
  sellerStrikes,
  type SellerStrikeRow,
  type SellerStrikes,
} from '@/lib/admin-api';

const REASON_LABEL: Record<string, string> = {
  ITEM_NO_LONGER_AVAILABLE: 'Item no longer available',
  ITEM_DAMAGED: 'Item damaged',
  OFFER_TOO_LOW: 'Offer too low',
  BUYER_SUSPICIOUS: 'Buyer concerns',
  LISTING_ERROR: 'Listing error',
  CHANGED_MIND: 'Changed mind',
  SOLD_ELSEWHERE: 'Sold elsewhere',
  STOCK_ISSUE: 'Stock issue',
  CANT_FULFIL_SHIPPING: 'Cannot fulfil shipping',
  OTHER: 'Other',
};

/**
 * The reject-strike ledger. Removing ONE strike is the fair remedy when a
 * single rejection was not the seller's fault; the live count and listing ban
 * are recomputed server-side, so dropping below the threshold lifts the ban.
 */
export function SellerStrikesPanel({ userId }: { userId: string }) {
  const { toast } = useAdminToast();
  const [data, setData] = useState<SellerStrikes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SellerStrikeRow | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await sellerStrikes(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load strikes');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="adm-sub">{error}</p>;
  if (!data) return <p className="adm-sub">Loading strikes…</p>;

  const live = data.strikes.filter((s) => !s.removedAt);
  if (data.strikes.length === 0) {
    return (
      <p className="adm-sub" style={{ margin: 0 }}>
        No reject strikes on this seller.
      </p>
    );
  }

  return (
    <>
      <p className="adm-sub" style={{ marginTop: 0 }}>
        Live strikes: <strong>{data.sellerRejectStrikes}</strong>
        {data.sellingBannedAt
          ? ` · listing suspended ${formatWhen(data.sellingBannedAt)}`
          : ''}
      </p>
      {live.map((s) => (
        <div
          key={s.id}
          className="adm-row"
          style={{ cursor: 'default', alignItems: 'flex-start' }}
        >
          <span className="adm-row-text">
            <span className="adm-row-title">
              {REASON_LABEL[s.reason] ?? s.reason}
              {s.source === 'SALE' ? ' · paid sale' : ' · offer'}
            </span>
            <span className="adm-row-caption">
              {s.note ?? 'No note'} · {formatWhen(s.createdAt)}
            </span>
          </span>
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            onClick={() => setRemoving(s)}
          >
            Remove
          </button>
        </div>
      ))}

      <ConfirmDialog
        open={removing !== null}
        title="Remove this strike?"
        body="Removes only this rejection. The live strike count and the listing ban are recomputed immediately; listings the ban cancelled stay cancelled."
        confirmLabel="Remove strike"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await removeSellerStrike(removing.id);
          toast('Strike removed.');
          setRemoving(null);
          await load();
        }}
      />
    </>
  );
}
