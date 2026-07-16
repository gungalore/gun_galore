'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

// P1.4 — held-funds (client money) position.
interface HeldBucket {
  count: number;
  cents: number;
}
interface HeldFunds {
  asOf: string;
  paymentMode: string;
  heldAwaitingRelease: HeldBucket;
  owedToSellers: HeldBucket;
  owedToBuyerRefunds: HeldBucket;
  swapCashHeld: HeldBucket;
  swapFundingInFlight: HeldBucket;
  totalClientFundsCents: number;
}
// P1.3 — Books failed-sync aggregate.
interface ZohoFailedRow {
  id: string;
  orderReference?: string | null;
  zohoSyncError?: string | null;
  errorMessage?: string | null;
}
interface ZohoFailedSwap {
  id: string;
  initiatorFundingRef?: string | null;
  swapFeeInitiator?: number;
  zohoInitiatorFeeReceiptId?: string | null;
  swapFeeOwner?: number;
  zohoOwnerFeeReceiptId?: string | null;
}
interface ZohoFailed {
  transactions: ZohoFailedRow[];
  featuredBids: ZohoFailedRow[];
  subscriptionCharges: ZohoFailedRow[];
  swaps: ZohoFailedSwap[];
  totalFailed: number;
}

function rand(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

// The manual-EFT pay-in (statement upload / inContact scan / unmatched queue)
// and the FNB payout-batch builder have been removed with the manual-EFT rail.
// What remains are the read-only money-state monitors: the Client-Funds-Payable
// (held funds) position and the Zoho Books failed-sync radar.
export default function HeldFundsAdminPage() {
  const [ready, setReady] = useState(false);
  const [heldFunds, setHeldFunds] = useState<HeldFunds | null>(null);
  const [zohoFailed, setZohoFailed] = useState<ZohoFailed | null>(null);

  useEffect(() => {
    setReady(requireAdminToken());
  }, []);

  const load = useCallback(async () => {
    const [h, z] = await Promise.all([
      adminFetch('/admin/manual-payments/held-funds'),
      adminFetch('/admin/manual-payments/zoho-failed'),
    ]);
    if (h.ok) setHeldFunds(await h.json());
    if (z.ok) setZohoFailed(await z.json());
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) {
    return <div className="p-6 text-sm text-[var(--text-tertiary)]">Admin sign-in required.</div>;
  }

  return (
    <div className="p-6 max-w-[960px]">
      <h1 className="text-xl font-medium mb-1">Held funds &amp; books</h1>
      <p className="text-sm text-[var(--text-tertiary)] mb-6">
        Read-only money-state monitors: how much of the bank balance belongs to
        members, and which accounting syncs need attention. Payments are not
        being taken while the card gateway is offline.
      </p>

      {/* P1.4 — Held funds (client money) position */}
      <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">Held funds — client money position</h2>
        <p className="text-xs mb-3 text-[var(--text-tertiary)]">
          How much of the bank balance belongs to members, not Gun Galore. The
          bank balance should always be at least the total below.
        </p>
        {!heldFunds ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    ['Buyer money held (awaiting delivery/release)', heldFunds.heldAwaitingRelease],
                    ['Owed to sellers (released, not yet paid out)', heldFunds.owedToSellers],
                    ['Owed to buyers (refunds not yet paid)', heldFunds.owedToBuyerRefunds],
                    ['Swap cash top-ups held (locked swaps)', heldFunds.swapCashHeld],
                    ['Swap funding in flight (one side paid, pre-lock)', heldFunds.swapFundingInFlight],
                  ] as Array<[string, HeldBucket]>
                ).map(([label, bucket]) => (
                  <tr key={label} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="py-2 pr-4">{label}</td>
                    <td className="py-2 pr-4 text-[var(--text-tertiary)]">{bucket.count} item{bucket.count === 1 ? '' : 's'}</td>
                    <td className="py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(bucket.cents)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '0.5px solid var(--border)' }}>
                  <td className="py-2 pr-4 font-medium">Total client funds</td>
                  <td className="py-2 pr-4" />
                  <td className="py-2 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--red)' }}>
                    {rand(heldFunds.totalClientFundsCents)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs mt-2 text-[var(--text-tertiary)]">
              As of {new Date(heldFunds.asOf).toLocaleString('en-ZA')} · payment mode: {heldFunds.paymentMode}
            </p>
          </div>
        )}
      </section>

      {/* P1.3 — Zoho Books failed syncs */}
      <section className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">Zoho Books — failed syncs</h2>
        {!zohoFailed ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : zohoFailed.totalFailed === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">All Books syncs healthy — nothing failed.</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>
              {zohoFailed.totalFailed} entit{zohoFailed.totalFailed === 1 ? 'y' : 'ies'} failed their last Books sync. Transactions &amp; featured bids retry from their dossier; swap leg-fee receipts retry automatically each hour.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Transaction', zohoFailed.transactions],
                    ['Featured bid', zohoFailed.featuredBids],
                    ['Subscription', zohoFailed.subscriptionCharges],
                  ] as Array<[string, ZohoFailedRow[]]>
                ).flatMap(([type, rows]) =>
                  rows.map((r) => (
                    <tr key={`${type}-${r.id}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                      <td className="py-2 pr-4">{type}</td>
                      <td className="py-2 pr-4">{r.orderReference ?? r.id.slice(-8).toUpperCase()}</td>
                      <td className="py-2 text-[var(--text-tertiary)]">{r.zohoSyncError ?? r.errorMessage ?? '—'}</td>
                    </tr>
                  )),
                )}
                {/* P1.3 — swap leg-fee receipts (no zohoSync* columns; the
                    signal is a missing receipt id). Auto-retried hourly. */}
                {(zohoFailed.swaps ?? []).map((s) => (
                  <tr key={`Swap-${s.id}`} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="py-2 pr-4">Swap fee</td>
                    <td className="py-2 pr-4">{s.initiatorFundingRef ?? s.id.slice(-8).toUpperCase()}</td>
                    <td className="py-2 text-[var(--text-tertiary)]">Leg-fee Sales Receipt missing — awaiting hourly retry.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
