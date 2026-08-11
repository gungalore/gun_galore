'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

const rand = (cents: number) =>
  'R' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Period = '7d' | '30d' | '90d' | '365d' | 'all';

interface Analytics {
  kpis: {
    salesCount: number;
    grossSalesCents: number;
    netPayoutCents: number;
    avgOrderValueCents: number;
    activeListings: number;
    soldListings: number;
  };
  timeSeries: { bucket: string; gmvCents: number; payoutCents: number; salesCount: number }[];
}

interface Statement {
  summary: {
    orderCount: number;
    grossSales: number;
    totalCommission: number;
    totalProcessingFees: number;
    totalShipping: number;
    netPayout: number;
    refundedCount: number;
  };
  orders: {
    id: string;
    reference: string | null;
    date: string;
    listingTitle: string;
    buyerUsername: string | null;
    status: string;
    listingPrice: number;
    commission: number;
    processingFee: number;
    shipping: number;
    netPayout: number;
  }[];
}

export default function EarningsPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [period, setPeriod] = useState<Period>('30d');
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [aRes, sRes] = await Promise.all([
        fetch(`${API_URL}/sellers/me/analytics?period=${period}`, { headers }),
        fetch(`${API_URL}/sellers/me/statement`, { headers }),
      ]);
      if (!aRes.ok || !sRes.ok) throw new Error('Could not load your earnings');
      setAnalytics(await aRes.json());
      setStatement(await sRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [getToken, period]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void load();
  }, [isLoaded, isSignedIn, load]);

  async function downloadCsv() {
    const token = await getToken();
    const res = await fetch(`${API_URL}/sellers/me/statement.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-outdoor-payout-statement.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoaded && !isSignedIn) {
    return <p className="p-6 text-[var(--text-secondary)]">Please sign in to view your earnings.</p>;
  }

  const k = analytics?.kpis;
  const maxGmv = Math.max(1, ...(analytics?.timeSeries.map((p) => p.gmvCents) ?? [1]));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Earnings &amp; insights</h1>
        <select
          aria-label="Period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="text-sm px-2 py-1.5 rounded-md bg-[var(--bg-inset)] border border-[var(--border)] text-[var(--text-primary)]"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="365d">Last year</option>
          <option value="all">All time</option>
        </select>
      </div>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      {loading && <p className="text-sm text-[var(--text-tertiary)]">Loading…</p>}

      {k && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Kpi label="Net payout" value={rand(k.netPayoutCents)} accent />
          <Kpi label="Sales" value={String(k.salesCount)} />
          <Kpi label="Gross sales" value={rand(k.grossSalesCents)} />
          <Kpi label="Avg order" value={rand(k.avgOrderValueCents)} />
          <Kpi label="Active listings" value={String(k.activeListings)} />
          <Kpi label="Sold listings" value={String(k.soldListings)} />
        </div>
      )}

      {analytics && analytics.timeSeries.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
            Revenue (released sales)
          </p>
          <div className="flex items-end gap-1 h-28">
            {analytics.timeSeries.map((p) => (
              <div
                key={p.bucket}
                title={`${p.bucket.slice(0, 10)} · ${rand(p.gmvCents)} (${p.salesCount} sale${p.salesCount === 1 ? '' : 's'})`}
                className="flex-1 rounded-t"
                style={{
                  height: `${Math.max(4, (p.gmvCents / maxGmv) * 100)}%`,
                  background: 'var(--accent, #2563eb)',
                  minWidth: 3,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Note: view-count isn't tracked, so we don't show a views/conversion
          metric — only money + listing counts, which are real. */}

      {statement && (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Payout statement</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                Last 90 days · {statement.summary.orderCount} released ·{' '}
                {rand(statement.summary.netPayout)} net
              </p>
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)]"
            >
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)] text-xs">
                  <th className="p-3">Item</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Item price</th>
                  <th className="p-3 text-right">Fees</th>
                  <th className="p-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {statement.orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-[var(--border-divider)]"
                    style={{ opacity: o.status === 'REFUNDED' ? 0.5 : 1 }}
                  >
                    <td className="p-3 text-[var(--text-primary)]">
                      {o.listingTitle}
                      {o.status === 'REFUNDED' && (
                        <span className="ml-1 text-xs text-[var(--red)]">(refunded)</span>
                      )}
                    </td>
                    <td className="p-3 text-[var(--text-tertiary)]">{o.date.slice(0, 10)}</td>
                    <td className="p-3 text-right text-[var(--text-secondary)]">{rand(o.listingPrice)}</td>
                    <td className="p-3 text-right text-[var(--text-secondary)]">
                      {rand(o.commission + o.processingFee + o.shipping)}
                    </td>
                    <td className="p-3 text-right text-[var(--text-primary)] font-medium">
                      {rand(o.netPayout)}
                    </td>
                  </tr>
                ))}
                {statement.orders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-[var(--text-tertiary)]">
                      No payouts in this window yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
      <p
        className="text-lg font-semibold mt-0.5"
        style={{ color: accent ? 'var(--accent, #2563eb)' : 'var(--text-primary)' }}
      >
        {value}
      </p>
    </div>
  );
}
