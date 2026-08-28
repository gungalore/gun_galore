'use client';

// DD-5 — Daily Deals P&L dashboard. First-party financial performance of the
// deals programme: product gross sales, COGS, gross profit + margin, units
// sold and sell-through, per-deal and in aggregate. ADMIN-ONLY (shows cost +
// margin). Numbers come from the Transaction table (the money source of
// truth) — a sale counts only when it's paid and not refunded/cancelled/
// rejected. Product MARGIN is refund-independent (refundedAmount is measured
// against the full charge incl. shipping/fees, so it can't be netted into a
// product-only gross); refunds are shown as their own line. Empty while the
// programme is inert (no deals sold yet) — that's expected, not an error.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import { AdminCsvButton, type CsvColumn } from '@/components/admin/csv-export';
import DateField from '@/components/date-field';
import { toIso, todayYmd } from '@/lib/date-picker-model';

interface PnlDeal {
  id: string;
  title: string;
  status: string;
  dropDate: string | null;
  liveAt: string | null;
  costPriceCents: number;
  dealPriceCents: number;
  wasPriceCents: number;
  initialStock: number;
  unitsSold: number;
  sellThroughPct: number;
  grossSalesCents: number;
  refundsCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
}
interface PnlTotals {
  dealsRun: number;
  dealsLive: number;
  unitsSold: number;
  grossSalesCents: number;
  refundsCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
  avgSellThroughPct: number;
}
interface PnlReport {
  totals: PnlTotals;
  deals: PnlDeal[];
}

// Money exported as PLAIN RAND NUMBERS, not the en-ZA display strings — the
// on-screen formatter emits a non-breaking space that Excel imports as text,
// which silently breaks the accountant's SUM on the column that matters most.
const rands = (cents: number) => Number((cents / 100).toFixed(2));

const PNL_CSV: CsvColumn<PnlDeal>[] = [
  { header: 'Deal', value: (d) => d.title },
  { header: 'Status', value: (d) => d.status },
  { header: 'Drop date', value: (d) => d.dropDate?.slice(0, 10) ?? '' },
  { header: 'Units sold', value: (d) => d.unitsSold },
  { header: 'Initial stock', value: (d) => d.initialStock },
  { header: 'Sell-through %', value: (d) => d.sellThroughPct },
  { header: 'Cost price ZAR', value: (d) => rands(d.costPriceCents) },
  { header: 'Deal price ZAR', value: (d) => rands(d.dealPriceCents) },
  { header: 'Product sales ZAR', value: (d) => rands(d.grossSalesCents) },
  { header: 'Refunds ZAR', value: (d) => rands(d.refundsCents) },
  { header: 'COGS ZAR', value: (d) => rands(d.cogsCents) },
  { header: 'Gross profit ZAR', value: (d) => rands(d.grossProfitCents) },
  { header: 'Margin %', value: (d) => d.grossMarginPct },
];

function formatRand(cents: number, compact = false): string {
  const rand = cents / 100;
  const neg = rand < 0;
  const abs = Math.abs(rand);
  let body: string;
  if (compact && abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(2)}M`;
  else if (compact && abs >= 10_000) body = `${(abs / 1_000).toFixed(1)}k`;
  else
    body = abs.toLocaleString('en-ZA', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  return `${neg ? '−' : ''}R ${body}`;
}
const profitColor = (cents: number) => (cents >= 0 ? '#22c55e' : 'var(--red)');
const formatPct = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n)}%`;

function StatCard({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
}) {
  return (
    <div
      className="rounded-[8px] p-3.5"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p
        className="text-lg"
        style={{
          color: valueColor ?? 'var(--text-primary)',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </p>
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const TH = ({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) => (
  <th
    className={`${right ? 'text-right' : 'text-left'} px-4 py-2 text-xs uppercase whitespace-nowrap`}
    style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
  >
    {children}
  </th>
);

export default function DealsPnlPage() {
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      setLoaded(false);
      setError(false);
      const qs = new URLSearchParams();
      // Interpret the operator's picked calendar days in SAST (UTC+2), so a
      // deal that went live near midnight lands in the day the operator means.
      if (from) qs.set('from', `${from}T00:00:00+02:00`);
      if (to) qs.set('to', `${to}T23:59:59.999+02:00`);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const res = await adminFetch(`/admin/deals/pnl${q}`).catch(() => null);
      if (cancelled) return;
      if (res && res.ok) {
        setReport(await res.json());
      } else {
        // A failed / unauthorized fetch is NOT "no sales" — surface it as an
        // error so an empty dashboard isn't mistaken for a quiet period.
        setReport(null);
        setError(true);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const t = report?.totals;
  const deals = report?.deals ?? [];

  // 12px type and 4px padding is below the touch floor the rest of the app
  // holds itself to, and it is the operator — who has reported not being able
  // to read low-contrast UI — who works these screens.
  const dateInput = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 14,
  } as const;

  return (
    <div>
      <AdminPageHeader
        title="Daily Deals P&L"
        description="First-party programme performance. Counts paid sales (held + released) and excludes cancelled/rejected/refunded orders. Product margin = product price − supplier cost × units; shipping, fees and refunds sit outside the product margin and refunds are shown as their own line (cash returned to buyers)."
        actions={
          <Link href="/admin/deals" className="text-sm" style={{ color: 'var(--red)' }}>
            ← Deals cockpit
          </Link>
        }
      />

      {/* Date range filter */}
      <div className="flex items-center gap-2 flex-wrap mb-5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <span>Go-live between</span>
        <div style={{ width: 190 }}>
          <DateField label="From date" value={from} onChange={setFrom} style={dateInput} max={toIso(todayYmd())} allowClear />
        </div>
        <span>and</span>
        <div style={{ width: 190 }}>
          <DateField label="To date" value={to} onChange={setTo} style={dateInput} min={from || undefined} max={toIso(todayYmd())} allowClear />
        </div>
        {(from || to) && (
          <button type="button" onClick={() => { setFrom(''); setTo(''); }} style={{ color: 'var(--red)' }}>
            Clear
          </button>
        )}
        {!from && !to && <span style={{ color: 'var(--text-tertiary)' }}>· showing all-time (SAST days)</span>}
      </div>

      {!loaded ? (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      ) : error ? (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--red)', fontWeight: 500 }}>
            Couldn&apos;t load the P&amp;L
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            The request failed — check that you&apos;re still signed in as an admin
            and the backend is reachable, then retry.
          </p>
        </div>
      ) : !t || t.dealsRun === 0 ? (
        <div
          className="rounded-[8px] p-8 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-sm mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            No deal sales in this period yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            The P&amp;L populates once deals go live and start selling. While Daily
            Deals is switched off this stays empty — that&apos;s expected.
          </p>
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Gross profit"
              value={formatRand(t.grossProfitCents, true)}
              valueColor={profitColor(t.grossProfitCents)}
              hint={`${formatPct(t.grossMarginPct)} product margin`}
            />
            <StatCard label="Product sales" value={formatRand(t.grossSalesCents, true)} hint="Item price × units (excl. shipping)" />
            <StatCard label="COGS" value={formatRand(t.cogsCents, true)} hint="Supplier cost of units sold" />
            <StatCard label="Units sold" value={t.unitsSold.toLocaleString('en-ZA')} hint={`${t.avgSellThroughPct}% sell-through`} />
            <StatCard label="Avg sell-through" value={`${t.avgSellThroughPct}%`} hint="Units sold ÷ go-live stock" />
            <StatCard
              label="Deals run"
              value={t.dealsRun.toLocaleString('en-ZA')}
              hint={`${t.dealsLive} live now`}
            />
            <StatCard
              label="Refunds"
              value={formatRand(t.refundsCents, true)}
              valueColor={t.refundsCents > 0 ? 'var(--red)' : undefined}
              hint="Cash returned (incl. shipping) — outside margin"
            />
            <StatCard label="Margin" value={formatPct(t.grossMarginPct)} hint="Gross profit ÷ product sales" />
          </div>

          {/* Per-deal table */}
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div
              className="px-4 py-3 flex items-start justify-between gap-3"
              style={{ borderBottom: '0.5px solid var(--border)' }}
            >
              <div>
                <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  Per-deal breakdown
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Best performers first (by gross profit).
                </p>
              </div>
              {/* The accountant conversation runs off this table — exporting it
                  beats retyping figures out of a dark-themed screenshot. */}
              <AdminCsvButton
                rows={deals}
                columns={PNL_CSV}
                table="deals p and l"
                range={from && to ? `${from}-to-${to}` : undefined}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 720 }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <TH>Deal</TH>
                    <TH right>Sold / stock</TH>
                    <TH right>Sell-through</TH>
                    <TH right>Product sales</TH>
                    <TH right>COGS</TH>
                    <TH right>Gross profit</TH>
                    <TH right>Margin</TH>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d, i) => (
                    <tr
                      key={d.id}
                      style={i < deals.length - 1 ? { borderBottom: '0.5px solid var(--border)' } : undefined}
                    >
                      <td className="px-4 py-2.5" style={{ color: 'var(--text-primary)' }}>
                        <Link href="/admin/deals" className="hover:underline" style={{ color: 'var(--text-primary)' }}>
                          {d.title}
                        </Link>
                        <span className="ml-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {d.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {d.unitsSold} / {d.initialStock}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {d.sellThroughPct}%
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatRand(d.grossSalesCents)}
                        {d.refundsCents > 0 && (
                          <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            {formatRand(d.refundsCents)} refunded
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatRand(d.cogsCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: profitColor(d.grossProfitCents), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatRand(d.grossProfitCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatPct(d.grossMarginPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
