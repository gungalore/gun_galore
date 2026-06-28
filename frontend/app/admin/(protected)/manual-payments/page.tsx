'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminFetch, requireAdminToken, getAdminToken } from '@/lib/admin-auth';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ManualPayment {
  id: string;
  source: string;
  amountCents: number;
  reference: string | null;
  status: string;
  note: string | null;
  createdAt: string;
}
interface ReconResult {
  rows: number;
  creditRows: number;
  verified: number;
  unmatched: number;
  ambiguous: number;
  alreadyDone: number;
}
interface DueRow {
  id: string;
  orderReference: string | null;
  sellerPayout?: number;
  buyerTotal?: number;
  seller?: { username: string | null; bankAccountHolder: string | null };
  buyer?: { username: string | null; bankAccountHolder: string | null };
}
interface PayoutsDue {
  payouts: DueRow[];
  refunds: DueRow[];
}
interface PayoutBatch {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  payoutTotal: number;
  refundTotal: number;
  grandTotal: number;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}

function rand(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

export default function ManualPaymentsAdminPage() {
  const [ready, setReady] = useState(false);
  const [unmatched, setUnmatched] = useState<ManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [due, setDue] = useState<PayoutsDue | null>(null);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);

  useEffect(() => {
    setReady(requireAdminToken());
  }, []);

  const loadUnmatched = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch('/admin/manual-payments/unmatched');
    if (res.ok) setUnmatched(await res.json());
    setLoading(false);
  }, []);

  const loadPayouts = useCallback(async () => {
    const [d, b] = await Promise.all([
      adminFetch('/admin/manual-payments/payouts-due'),
      adminFetch('/admin/manual-payments/payout-batches'),
    ]);
    if (d.ok) setDue(await d.json());
    if (b.ok) setBatches(await b.json());
  }, []);

  useEffect(() => {
    if (ready) {
      void loadUnmatched();
      void loadPayouts();
    }
  }, [ready, loadUnmatched, loadPayouts]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await adminFetch('/admin/manual-payments/statement', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      const r = data as ReconResult;
      setUploadMsg(
        `Reconciled ${r.creditRows} credit rows → ${r.verified} verified, ${r.ambiguous} ambiguous, ${r.unmatched} unmatched, ${r.alreadyDone} already done.`,
      );
      await loadUnmatched();
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function onScan() {
    setScanMsg('Scanning…');
    const res = await adminFetch('/admin/manual-payments/scan', { method: 'POST' });
    if (res.ok) {
      const r = await res.json();
      setScanMsg(
        `Scanned ${r.scanned}, detected ${r.detected}, unmatched ${r.unmatched}.`,
      );
      await loadUnmatched();
    } else {
      setScanMsg('Scan failed');
    }
  }

  // Blob-download a batch's frozen FNB CSV (needs the admin Bearer header).
  async function downloadBatchCsv(batchId: string) {
    const res = await fetch(
      `${API_URL}/admin/manual-payments/payout-batches/${batchId}.csv`,
      { headers: { Authorization: `Bearer ${getAdminToken() ?? ''}` } },
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gungalore-payout-batch-${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Freeze everything currently due into a new batch + download its FNB file.
  async function freezeAndDownload() {
    setPayoutBusy(true);
    setPayoutMsg(null);
    try {
      const res = await adminFetch('/admin/manual-payments/payout-batches', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      await downloadBatchCsv(data.batchId);
      const skipNote = data.skipped
        ? ` ${data.skipped} row(s) skipped for missing bank details.`
        : '';
      setPayoutMsg(
        `Batch frozen: ${data.included} recipient(s), ${rand(data.grandTotal)} total — CSV downloaded. Pay it in FNB, then mark it paid below.${skipNote}`,
      );
      await loadPayouts();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : 'Could not create batch');
    } finally {
      setPayoutBusy(false);
    }
  }

  async function markBatchPaid(batchId: string, total: number) {
    if (
      !window.confirm(
        `Confirm you have made the FNB bulk payment of ${rand(total)} for this batch. This marks every recipient paid and cannot be undone.`,
      )
    )
      return;
    setPayoutBusy(true);
    setPayoutMsg(null);
    try {
      const res = await adminFetch(
        `/admin/manual-payments/payout-batches/${batchId}/mark-paid`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setPayoutMsg(`Batch marked paid — ${data.settledPayouts} payout(s) settled.`);
      await loadPayouts();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : 'Could not mark paid');
    } finally {
      setPayoutBusy(false);
    }
  }

  async function cancelBatch(batchId: string) {
    if (
      !window.confirm(
        'Cancel this batch? Its payouts/refunds return to the due queue so they appear in the next batch. Use this if you have NOT paid it.',
      )
    )
      return;
    setPayoutBusy(true);
    setPayoutMsg(null);
    try {
      const res = await adminFetch(
        `/admin/manual-payments/payout-batches/${batchId}/cancel`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setPayoutMsg('Batch cancelled — lines returned to the queue.');
      await loadPayouts();
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : 'Could not cancel');
    } finally {
      setPayoutBusy(false);
    }
  }

  if (!ready) {
    return <div className="p-6 text-sm text-[var(--text-tertiary)]">Admin sign-in required.</div>;
  }

  return (
    <div className="p-6 max-w-[960px]">
      <h1 className="text-xl font-medium mb-1">Manual payments</h1>
      <p className="text-sm text-[var(--text-tertiary)] mb-6">
        Reconcile FNB EFT payments and prepare seller payouts while the card
        gateway is offline.
      </p>

      {/* Statement upload — authoritative reconciliation */}
      <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">1 · Upload FNB statement (CSV)</h2>
        <p className="text-sm text-[var(--text-tertiary)] mb-3">
          The authoritative step — matches the day&apos;s credits to orders by
          reference + amount and confirms them (notifies the seller to dispatch).
        </p>
        <label className="inline-block text-sm px-4 py-2 rounded-[6px] cursor-pointer" style={{ background: 'var(--red)', color: '#fff' }}>
          {uploading ? 'Reconciling…' : 'Choose statement.csv'}
          <input type="file" accept=".csv" onChange={onUpload} disabled={uploading} className="hidden" />
        </label>
        {uploadMsg && <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>{uploadMsg}</p>}
      </section>

      {/* inContact scan */}
      <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">2 · inContact inbox scan</h2>
        <p className="text-sm text-[var(--text-tertiary)] mb-3">
          Runs automatically every 10 min (provisional detection only). Trigger
          a manual scan here if needed.
        </p>
        <button onClick={onScan} className="text-sm px-4 py-2 rounded-[6px]" style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
          Scan now
        </button>
        {scanMsg && <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>{scanMsg}</p>}
      </section>

      {/* Payout batch */}
      {(() => {
        const dueRows = [
          ...(due?.payouts ?? []).map((p) => ({
            kind: 'Payout' as const,
            id: p.id,
            who: p.seller?.username ?? p.seller?.bankAccountHolder ?? '—',
            ref: p.orderReference ?? '—',
            amount: p.sellerPayout ?? 0,
          })),
          ...(due?.refunds ?? []).map((r) => ({
            kind: 'Refund' as const,
            id: r.id,
            who: r.buyer?.username ?? r.buyer?.bankAccountHolder ?? '—',
            ref: r.orderReference ?? '—',
            amount: r.buyerTotal ?? 0,
          })),
        ];
        const dueTotal = dueRows.reduce((s, r) => s + r.amount, 0);
        const pending = batches.filter((b) => b.status === 'PENDING');
        const past = batches.filter((b) => b.status !== 'PENDING');
        return (
          <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
            <h2 className="text-base font-medium mb-1">3 · Payout batch (FNB bulk payment)</h2>
            <p className="text-sm text-[var(--text-tertiary)] mb-3">
              Seller payouts (released orders) + buyer refunds owed now. Freeze
              them into a dated batch, download the FNB file, pay it in FNB, then
              mark the batch paid. Sellers are notified by FNB on payment.
            </p>

            {/* Due preview */}
            {dueRows.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)] mb-3">Nothing is due right now.</p>
            ) : (
              <div className="overflow-x-auto mb-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-tertiary)]">
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Recipient</th>
                      <th className="py-2 pr-4">Reference</th>
                      <th className="py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueRows.map((r) => (
                      <tr key={r.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                        <td className="py-2 pr-4">{r.kind}</td>
                        <td className="py-2 pr-4">{r.who}</td>
                        <td className="py-2 pr-4 text-[var(--text-tertiary)]">{r.ref}</td>
                        <td className="py-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(r.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '0.5px solid var(--border)' }}>
                      <td className="py-2 pr-4 font-medium" colSpan={3}>Total ({dueRows.length})</td>
                      <td className="py-2 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(dueTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={freezeAndDownload}
              disabled={payoutBusy || dueRows.length === 0}
              className="text-sm px-4 py-2 rounded-[6px]"
              style={{
                background: payoutBusy || dueRows.length === 0 ? 'var(--bg-inset)' : 'var(--red)',
                color: payoutBusy || dueRows.length === 0 ? 'var(--text-tertiary)' : '#fff',
                fontWeight: 500,
              }}
            >
              {payoutBusy ? 'Working…' : 'Freeze & download batch'}
            </button>
            {payoutMsg && <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>{payoutMsg}</p>}

            {/* Pending batches awaiting "mark paid" */}
            {pending.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-medium mb-2">Awaiting payment confirmation</h3>
                {pending.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center gap-3 p-3 rounded-[6px] mb-2"
                    style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--warning, #d49a3a)' }}
                  >
                    <span className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {rand(b.grandTotal)} · {b.itemCount} recipient(s)
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)]">
                      frozen {new Date(b.createdAt).toLocaleString('en-ZA')}
                    </span>
                    <span className="flex-1" />
                    <button onClick={() => downloadBatchCsv(b.id)} className="text-xs px-3 py-1.5 rounded-[5px]" style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
                      Re-download CSV
                    </button>
                    <button onClick={() => markBatchPaid(b.id, b.grandTotal)} disabled={payoutBusy} className="text-xs px-3 py-1.5 rounded-[5px]" style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}>
                      Mark paid
                    </button>
                    <button onClick={() => cancelBatch(b.id)} disabled={payoutBusy} className="text-xs px-3 py-1.5 rounded-[5px]" style={{ border: '0.5px solid var(--border)', color: 'var(--text-tertiary)' }}>
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Recent batches */}
            {past.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-medium mb-2">Recent batches</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-tertiary)]">
                        <th className="py-1.5 pr-4">When</th>
                        <th className="py-1.5 pr-4">Total</th>
                        <th className="py-1.5 pr-4">Items</th>
                        <th className="py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {past.map((b) => (
                        <tr key={b.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                          <td className="py-1.5 pr-4 text-[var(--text-tertiary)]">
                            {new Date(b.paidAt ?? b.cancelledAt ?? b.createdAt).toLocaleString('en-ZA')}
                          </td>
                          <td className="py-1.5 pr-4" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(b.grandTotal)}</td>
                          <td className="py-1.5 pr-4">{b.itemCount}</td>
                          <td className="py-1.5" style={{ color: b.status === 'PAID' ? 'var(--green, #16a34a)' : 'var(--text-tertiary)' }}>{b.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Unmatched queue */}
      <section className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-3">Investigation queue</h2>
        {loading ? (
          <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>
        ) : unmatched.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">Nothing to investigate — all payments matched.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)]">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((m) => (
                  <tr key={m.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                    <td className="py-2 pr-4 text-[var(--text-tertiary)]">{new Date(m.createdAt).toLocaleString('en-ZA')}</td>
                    <td className="py-2 pr-4">{m.source}</td>
                    <td className="py-2 pr-4" style={{ fontVariantNumeric: 'tabular-nums' }}>{rand(m.amountCents)}</td>
                    <td className="py-2 pr-4">{m.reference ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <span style={{ color: m.status === 'AMBIGUOUS' ? 'var(--warning, #d49a3a)' : 'var(--red)' }}>{m.status}</span>
                    </td>
                    <td className="py-2 text-[var(--text-tertiary)]">{m.note ?? '—'}</td>
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
