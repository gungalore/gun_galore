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

  useEffect(() => {
    setReady(requireAdminToken());
  }, []);

  const loadUnmatched = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch('/admin/manual-payments/unmatched');
    if (res.ok) setUnmatched(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ready) void loadUnmatched();
  }, [ready, loadUnmatched]);

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

  async function downloadPayouts() {
    // CSV download needs the admin Bearer header, so fetch as a blob.
    const res = await fetch(`${API_URL}/admin/manual-payments/payouts-due.csv`, {
      headers: { Authorization: `Bearer ${getAdminToken() ?? ''}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gungalore-payouts-PLACEHOLDER.csv';
    a.click();
    URL.revokeObjectURL(url);
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

      {/* Payout CSV */}
      <section className="rounded-[8px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <h2 className="text-base font-medium mb-1">3 · Payout batch (CSV)</h2>
        <p className="text-sm text-[var(--text-tertiary)] mb-3">
          Seller payouts (released orders) + buyer refunds owed today.{' '}
          <strong style={{ color: 'var(--warning, #d49a3a)' }}>
            Placeholder column layout
          </strong>{' '}
          — swap for FNB&apos;s real bulk-payment template before importing. The
          &quot;mark batch paid&quot; settle + Zoho step lands with that template.
        </p>
        <button onClick={downloadPayouts} className="text-sm px-4 py-2 rounded-[6px]" style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
          Download payout CSV
        </button>
      </section>

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
