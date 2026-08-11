'use client';

import { useEffect, useState } from 'react';
import AnalyticsTabs from '../analytics-tabs';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import {
  AdminCsvButton,
  csvPeriodSlug,
  type CsvColumn,
} from '@/components/admin/csv-export';
import PeriodSwitcher from './period-switcher';
import {
  KpiCard,
  TimeSeriesChart,
  CategoryBarChart,
  ListingTypeDonut,
} from './charts';

// ─── Types matching backend response shapes ─────────────────────────

interface OverviewKpis {
  gmvCents: number;
  gmvCentsPrev: number;
  revenueCents: number;
  revenueCentsPrev: number;
  txCount: number;
  txCountPrev: number;
  aovCents: number;
  aovCentsPrev: number;
  refundRate: number;
  refundRatePrev: number;
  disputeRate: number;
  disputeRatePrev: number;
}

interface TimeSeriesPoint {
  bucket: string;
  gmvCents: number;
  revenueCents: number;
  txCount: number;
}

interface ByListingType {
  listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT';
  count: number;
  gmvCents: number;
}

interface ByCategory {
  categoryName: string;
  count: number;
  gmvCents: number;
}

interface TopMakeModel {
  make: string;
  model: string;
  count: number;
  gmvCents: number;
  avgPriceCents: number;
}

interface TimeToSale {
  categoryName: string;
  medianDays: number;
  sold: number;
}

// ─── Formatters ─────────────────────────────────────────────────────

function formatRand(cents: number, compact = false): string {
  const rand = cents / 100;
  if (compact && rand >= 1_000_000) return `R${(rand / 1_000_000).toFixed(2)}M`;
  if (compact && rand >= 10_000) return `R${(rand / 1_000).toFixed(1)}k`;
  return `R${rand.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

function formatCount(n: number): string {
  return n.toLocaleString('en-ZA');
}

// ─── CSV exports ────────────────────────────────────────────────────
// Money goes out as a plain Rand NUMBER (1234.5), never the display string
// ("R1 234"): the on-screen formatter uses en-ZA grouping — a non-breaking
// space — which Excel imports as text, so an accountant's SUM would silently
// return 0. Cents → Rand with 2dp, kept numeric.
function randValue(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

const TOP_MAKE_MODEL_CSV: CsvColumn<TopMakeModel>[] = [
  { header: 'Make', value: (r) => r.make },
  { header: 'Model', value: (r) => r.model },
  { header: 'Sales', value: (r) => r.count },
  { header: 'Avg price (ZAR)', value: (r) => randValue(r.avgPriceCents) },
  { header: 'GMV (ZAR)', value: (r) => randValue(r.gmvCents) },
];

const TIME_TO_SALE_CSV: CsvColumn<TimeToSale>[] = [
  { header: 'Category', value: (r) => r.categoryName },
  { header: 'Sales', value: (r) => r.sold },
  { header: 'Median days to sale', value: (r) => r.medianDays },
];

const TIME_SERIES_CSV: CsvColumn<TimeSeriesPoint>[] = [
  // bucket is a full ISO timestamp (date_trunc'd); the date part is what the
  // operator actually reconciles against, and Excel reads it as a date.
  { header: 'Period start', value: (p) => p.bucket.slice(0, 10) },
  { header: 'GMV (ZAR)', value: (p) => randValue(p.gmvCents) },
  { header: 'Platform revenue (ZAR)', value: (p) => randValue(p.revenueCents) },
  { header: 'Sales', value: (p) => p.txCount },
];

// ─── Page ───────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') ?? '30d';
  const bucket = searchParams.get('bucket') ?? 'day';
  const qs = `?period=${period}`;

  const [overview, setOverview] = useState<OverviewKpis | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[] | null>(null);
  const [byType, setByType] = useState<ByListingType[] | null>(null);
  const [byCategory, setByCategory] = useState<ByCategory[] | null>(null);
  const [topMakes, setTopMakes] = useState<TopMakeModel[] | null>(null);
  const [timeToSale, setTimeToSale] = useState<TimeToSale[] | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      // Fire every analytics call in parallel — they're all independent
      // and the page can't render anything useful until they all land.
      const [oRes, tsRes, btRes, bcRes, tmRes, ttsRes] = await Promise.all([
        adminFetch(`/admin/analytics/overview${qs}`),
        adminFetch(`/admin/analytics/time-series${qs}&bucket=${bucket}`),
        adminFetch(`/admin/analytics/by-listing-type${qs}`),
        adminFetch(`/admin/analytics/by-category${qs}`),
        adminFetch(`/admin/analytics/top-make-model${qs}`),
        adminFetch(`/admin/analytics/time-to-sale${qs}`),
      ]);
      if (cancelled) return;
      if (oRes.ok) setOverview(await oRes.json());
      else setOverview(null);
      if (tsRes.ok) setTimeSeries(await tsRes.json());
      else setTimeSeries(null);
      if (btRes.ok) setByType(await btRes.json());
      else setByType(null);
      if (bcRes.ok) setByCategory(await bcRes.json());
      else setByCategory(null);
      if (tmRes.ok) setTopMakes(await tmRes.json());
      else setTopMakes(null);
      if (ttsRes.ok) setTimeToSale(await ttsRes.json());
      else setTimeToSale(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [qs, bucket]);

  // Header strip stays even when downstream calls fail so the user can
  // still flip period to try again.
  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-2">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Sales Analytics
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          All amounts in ZAR · Counts RELEASED transactions only
        </p>
      </div>

      <AnalyticsTabs />

      <PeriodSwitcher currentPeriod={period} currentBucket={bucket} />

      {/* KPIs */}
      {overview ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="GMV"
            value={overview.gmvCents}
            prev={overview.gmvCentsPrev}
            formatter={(v) => formatRand(v, true)}
            hint="Gross merchandise value"
          />
          <KpiCard
            label="Platform revenue"
            value={overview.revenueCents}
            prev={overview.revenueCentsPrev}
            formatter={(v) => formatRand(v, true)}
            hint="Commission earned"
          />
          <KpiCard
            label="Avg order value"
            value={overview.aovCents}
            prev={overview.aovCentsPrev}
            formatter={(v) => formatRand(v)}
            hint={`${formatCount(overview.txCount)} completed sale${overview.txCount === 1 ? '' : 's'}`}
          />
          <KpiCard
            label="Refund rate"
            value={overview.refundRate}
            prev={overview.refundRatePrev}
            formatter={formatPercent}
            goodDirection="down"
            hint={
              overview.disputeRate > 0
                ? `${formatPercent(overview.disputeRate)} disputed`
                : 'No disputes'
            }
          />
        </div>
      ) : (
        <div
          className="rounded-[8px] p-5 mb-6 text-center text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px dashed var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          Could not load KPIs. Check that the backend is running and you&apos;re
          signed in.
        </div>
      )}

      {/* Time-series — full width. The export sits above the chart rather
          than inside it so the shared chart component stays presentational. */}
      {timeSeries && (
        <div className="mb-4">
          <div className="flex justify-end mb-1.5">
            <AdminCsvButton
              rows={timeSeries}
              columns={TIME_SERIES_CSV}
              table={`gmv by ${bucket}`}
              range={csvPeriodSlug(period)}
            />
          </div>
          <TimeSeriesChart points={timeSeries} bucket={bucket as 'day' | 'week' | 'month'} />
        </div>
      )}

      {/* Type donut + category bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {byType && <ListingTypeDonut rows={byType} />}
        {byCategory && <CategoryBarChart rows={byCategory} />}
      </div>

      {/* Top makes/models table */}
      {topMakes && topMakes.length > 0 && (
        <div
          className="rounded-[8px] overflow-hidden mb-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div
            className="px-5 py-3 flex items-start justify-between gap-3"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Top makes &amp; models
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Most-sold guns by make + model — basis for a future public price index
              </p>
            </div>
            <AdminCsvButton
              rows={topMakes}
              columns={TOP_MAKE_MODEL_CSV}
              table="top makes and models"
              range={csvPeriodSlug(period)}
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <th className="text-left px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Make &amp; model
                </th>
                <th className="text-right px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Sales
                </th>
                <th className="text-right px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Avg price
                </th>
                <th className="text-right px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  GMV
                </th>
              </tr>
            </thead>
            <tbody>
              {topMakes.map((row, i) => (
                <tr
                  key={`${row.make}-${row.model}-${i}`}
                  style={
                    i < topMakes.length - 1
                      ? { borderBottom: '0.5px solid var(--border)' }
                      : undefined
                  }
                >
                  <td className="px-5 py-2.5" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ fontWeight: 500 }}>{row.make}</span>{' '}
                    <span style={{ color: 'var(--text-tertiary)' }}>{row.model}</span>
                  </td>
                  <td className="px-5 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatCount(row.count)}
                  </td>
                  <td className="px-5 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatRand(row.avgPriceCents)}
                  </td>
                  <td className="px-5 py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>
                    {formatRand(row.gmvCents, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Median time-to-sale by category */}
      {timeToSale && timeToSale.length > 0 && (
        <div
          className="rounded-[8px] overflow-hidden mb-4"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <div
            className="px-5 py-3 flex items-start justify-between gap-3"
            style={{ borderBottom: '0.5px solid var(--border)' }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Median time-to-sale by category
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                How long a listing sits before it sells. Categories with fewer than 3 sales are hidden.
              </p>
            </div>
            <AdminCsvButton
              rows={timeToSale}
              columns={TIME_TO_SALE_CSV}
              table="time to sale by category"
              range={csvPeriodSlug(period)}
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <th className="text-left px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Category
                </th>
                <th className="text-right px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Sales
                </th>
                <th className="text-right px-5 py-2 text-xs uppercase" style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Median days
                </th>
              </tr>
            </thead>
            <tbody>
              {timeToSale.map((row, i) => (
                <tr
                  key={row.categoryName}
                  style={
                    i < timeToSale.length - 1
                      ? { borderBottom: '0.5px solid var(--border)' }
                      : undefined
                  }
                >
                  <td className="px-5 py-2.5" style={{ color: 'var(--text-primary)' }}>
                    {row.categoryName}
                  </td>
                  <td className="px-5 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {formatCount(row.sold)}
                  </td>
                  <td className="px-5 py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>
                    {row.medianDays.toFixed(1)} {row.medianDays === 1 ? 'day' : 'days'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note — explains the empty-data states so they're not
          mistaken for bugs. */}
      <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Charts populate as transactions reach the RELEASED state. Empty
        sections in a quiet period are expected and not an error.
      </p>
    </div>
  );
}
