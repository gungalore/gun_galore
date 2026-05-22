import { cookies } from 'next/headers';
import Link from 'next/link';
import PeriodSwitcher from './period-switcher';
import {
  KpiCard,
  TimeSeriesChart,
  CategoryBarChart,
  ListingTypeDonut,
} from './charts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

// ─── Fetch helper ───────────────────────────────────────────────────
//
// All endpoints are server-rendered with no-store caching so the page
// always reflects the latest DB state. Returns null on auth/network
// failure so the page can degrade to "could not load" instead of
// throwing during render.
async function fetchAdmin<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Page ───────────────────────────────────────────────────────────

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; bucket?: string }>;
}) {
  const sp = await searchParams;
  const period = sp.period ?? '30d';
  const bucket = sp.bucket ?? 'day';
  const qs = `?period=${period}`;

  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  // Fire every analytics call in parallel — they're all independent
  // and the page can't render anything useful until they all land.
  const [overview, timeSeries, byType, byCategory, topMakes, timeToSale] = await Promise.all([
    fetchAdmin<OverviewKpis>(`/admin/analytics/overview${qs}`, token),
    fetchAdmin<TimeSeriesPoint[]>(
      `/admin/analytics/time-series${qs}&bucket=${bucket}`,
      token,
    ),
    fetchAdmin<ByListingType[]>(`/admin/analytics/by-listing-type${qs}`, token),
    fetchAdmin<ByCategory[]>(`/admin/analytics/by-category${qs}`, token),
    fetchAdmin<TopMakeModel[]>(`/admin/analytics/top-make-model${qs}`, token),
    fetchAdmin<TimeToSale[]>(`/admin/analytics/time-to-sale${qs}`, token),
  ]);

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

      {/* Tab strip — Sales (this page) / Operational Health (sibling). */}
      <div className="flex gap-2 mb-4">
        <span
          className="px-3 py-1.5 rounded-full text-xs font-medium"
          style={{ background: 'var(--red)', color: '#fff' }}
        >
          Sales
        </span>
        <Link
          href="/admin/analytics/health"
          className="px-3 py-1.5 rounded-full text-xs"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          Operational Health
        </Link>
      </div>

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

      {/* Time-series — full width */}
      {timeSeries && (
        <div className="mb-4">
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
          <div className="px-5 py-3" style={{ borderBottom: '0.5px solid var(--border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Top makes &amp; models
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Most-sold guns by make + model — basis for a future public price index
            </p>
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
          <div className="px-5 py-3" style={{ borderBottom: '0.5px solid var(--border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Median time-to-sale by category
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              How long a listing sits before it sells. Categories with fewer than 3 sales are hidden.
            </p>
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
