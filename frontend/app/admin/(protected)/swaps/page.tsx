'use client';

// /admin/swaps — admin-owned swap resolution (S5). Lists swaps by status; for
// DISPUTED / AWAITING_VERIFICATION ones the admin can force-complete (release
// the held cash to the recipient) or unwind (refund the cash to the payer).
// Both actions are idempotent server-side (cashReleasedAt money-moved guard).

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { formatPrice } from '@/lib/utils';

interface Party {
  id: string;
  username: string | null;
}
interface SwapRow {
  id: string;
  status: string;
  cashAmount: number;
  cashPayerId: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  initiator: Party;
  owner: Party;
}
interface Leg {
  id: string;
  swapRole: string | null;
  paymentStatus: string;
  shippingStatus: string | null;
  shippingMethod: string | null;
  trackingReference: string | null;
  deliveredAt: string | null;
  shippingCost: number;
  orderReference: string | null;
  listing: { id: string; title: string } | null;
}
interface SwapDetail extends SwapRow {
  transactions: Leg[];
  initiatorFundingAmount: number;
  ownerFundingAmount: number;
  settlementTxId: string | null;
}

const FILTERS = [
  'DISPUTED',
  'AWAITING_VERIFICATION',
  'IN_TRANSIT',
  'LOCKED',
  'AWAITING_FUNDING',
  'COMPLETED',
  'CANCELLED',
  'ALL',
];

function dt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-ZA') : '—';
}

export default function AdminSwapsPage() {
  const [status, setStatus] = useState('DISPUTED');
  const [rows, setRows] = useState<SwapRow[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async (s: string) => {
    setRows(null);
    setErr('');
    const res = await adminFetch(`/admin/swaps?status=${s}`);
    if (res.ok) setRows(await res.json());
    else setErr(`Error ${res.status}`);
  }, []);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void load(status);
  }, [status, load]);

  return (
    <div>
      <h1 className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Swaps
      </h1>
      <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
        Resolve disputed or stalled swaps — force-complete releases the held cash
        to the recipient; unwind refunds it to the payer.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatus(f)}
            className="text-xs px-2.5 py-1 rounded-[6px]"
            style={{
              background: status === f ? 'var(--red)' : 'var(--bg-card)',
              color: status === f ? '#fff' : 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
            }}
          >
            {f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
      {!rows && !err && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      )}
      {rows && rows.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No swaps in this state.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {rows?.map((r) => (
          <SwapAdminCard key={r.id} row={r} onChange={() => load(status)} />
        ))}
      </div>
    </div>
  );
}

function SwapAdminCard({ row, onChange }: { row: SwapRow; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SwapDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const resolvable = ['DISPUTED', 'AWAITING_VERIFICATION'].includes(row.status);

  async function expand() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      const res = await adminFetch(`/admin/swaps/${row.id}`);
      if (res.ok) setDetail(await res.json());
    }
  }

  async function act(kind: 'force-complete' | 'unwind') {
    setErr('');
    let reason = '';
    if (kind === 'unwind') {
      reason = window.prompt('Reason for unwinding (refunds cash to the payer):') ?? '';
      if (!reason.trim()) return;
    } else if (
      !window.confirm(
        'Force-complete this swap? The held cash (if any) is released to the recipient and the swap closes.',
      )
    ) {
      return;
    }
    setBusy(kind);
    try {
      const res = await adminFetch(`/admin/swaps/${row.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message ?? `Error ${res.status}`);
      }
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      setBusy('');
    }
  }

  return (
    <div
      className="rounded-[8px] p-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={expand} className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
          {open ? '▾' : '▸'} {row.id.slice(0, 10)}…
        </button>
        <span className="text-xs px-2 py-0.5 rounded-[3px]"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}>
          {row.status.replace(/_/g, ' ')}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {row.initiator.username ?? '—'} ⇅ {row.owner.username ?? '—'}
        </span>
        {row.cashAmount > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            cash {formatPrice(row.cashAmount)}
          </span>
        )}
        <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>
          {dt(row.updatedAt)}
        </span>
      </div>

      {row.disputeReason && (
        <p className="text-xs mt-2" style={{ color: '#f59e0b' }}>
          Reported: “{row.disputeReason}”
        </p>
      )}

      {open && detail && (
        <div className="mt-3 flex flex-col gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {detail.transactions.map((l) => (
            <div key={l.id} className="flex flex-wrap gap-2"
              style={{ borderTop: '0.5px solid var(--border)', paddingTop: 6 }}>
              <span style={{ color: 'var(--text-primary)' }}>
                {l.swapRole === 'INITIATOR_GIVES' ? `${detail.initiator.username} →` : l.swapRole === 'OWNER_GIVES' ? `${detail.owner.username} →` : '⊕'} {l.listing?.title ?? '—'}
              </span>
              <span>ship: {l.shippingStatus ?? 'PENDING'}</span>
              {l.trackingReference && <span>track: {l.trackingReference}</span>}
              <span>delivered: {l.deliveredAt ? '✓' : '—'}</span>
              {l.orderReference && <span style={{ color: 'var(--text-tertiary)' }}>{l.orderReference}</span>}
            </div>
          ))}
          {detail.settlementTxId && (
            <p style={{ color: '#16a34a' }}>Settlement tx: {detail.settlementTxId}</p>
          )}
        </div>
      )}

      {resolvable && (
        <div className="flex gap-2 mt-3">
          <button onClick={() => act('force-complete')} disabled={!!busy}
            className="text-xs px-3 py-1.5 rounded-[6px] font-medium"
            style={{ background: '#16a34a', color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy === 'force-complete' ? '…' : 'Force-complete (release)'}
          </button>
          <button onClick={() => act('unwind')} disabled={!!busy}
            className="text-xs px-3 py-1.5 rounded-[6px] font-medium"
            style={{ background: 'var(--bg-inset)', color: 'var(--red)', border: '0.5px solid var(--red)', opacity: busy ? 0.6 : 1 }}>
            {busy === 'unwind' ? '…' : 'Unwind (refund payer)'}
          </button>
        </div>
      )}
      {err && <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}
