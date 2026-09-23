'use client';

import { useMemo, useState } from 'react';
import {
  EmptyState,
  KpiTile,
  NeonCard,
  Pill,
  SkeletonRows,
} from '@/components/admin/admin-ui';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  formatRand,
  type AnalyticsOverview,
  type ByCategory,
  type TimeSeriesPoint,
  type TopMakeModel,
} from '@/lib/admin-api';

/**
 * INSIGHTS IS THE SALES BOARD, NOT A SETTINGS PAGE.
 *
 * ⚠️ THE RUNTIME-FLAG TABLE THAT USED TO LIVE HERE WAS REMOVED 2026-09-22, ON
 * THE OPERATOR'S CALL, AND IT MUST NOT COME BACK. Those flags are rules the
 * codebase has already decided — the community feed's moderation posture, the
 * motivation writer's gate, the licence vault's master switch — and a rule that
 * has been decided does not belong behind an on/off switch in an operator
 * screen. Offering the toggle implies the decision is still open and invites a
 * mis-tap that silently turns off a statutory workflow.
 *
 * The backend registry and `PATCH /admin/settings/:key` still exist, because
 * some of those values are genuinely environment-shaped and are flipped
 * deliberately during a deploy. What is gone is the button.
 */
const PERIODS = ['7d', '30d', '90d', '365d', 'all'] as const;
type Period = (typeof PERIODS)[number];

function delta(now: number | undefined, prev: number | undefined): string {
  if (typeof now !== 'number' || typeof prev !== 'number' || prev === 0) return '';
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% vs prev`;
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<Period>('30d');

  const overview = useAdminPoll<AnalyticsOverview>(
    () =>
      adminFetch<AnalyticsOverview>(`/admin/analytics/overview?period=${period}`),
    60_000,
    [period],
  );
  const series = useAdminPoll<TimeSeriesPoint[]>(
    () =>
      adminFetch<TimeSeriesPoint[]>(
        `/admin/analytics/time-series?period=${period}&bucket=day`,
      ),
    120_000,
    [period],
  );
  const byCategory = useAdminPoll<ByCategory[]>(
    () =>
      adminFetch<ByCategory[]>(`/admin/analytics/by-category?period=${period}`),
    120_000,
    [period],
  );
  const topMake = useAdminPoll<TopMakeModel[]>(
    () =>
      adminFetch<TopMakeModel[]>(`/admin/analytics/top-make-model?period=${period}`),
    120_000,
    [period],
  );

  const o = overview.data;
  const points = series.data ?? [];
  const maxGmv = useMemo(
    () => Math.max(1, ...points.map((p) => p.gmvCents ?? 0)),
    [points],
  );
  const maxCategoryGmv = useMemo(
    () => Math.max(1, ...(byCategory.data ?? []).map((c) => c.gmvCents ?? 0)),
    [byCategory.data],
  );

  return (
    <>
      <div className="adm-scroll-x">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className="adm-chip"
            data-active={period === p}
            onClick={() => setPeriod(p)}
          >
            {p === 'all' ? 'All time' : `Last ${p}`}
          </button>
        ))}
      </div>

      <div className="adm-kpis">
        <KpiTile
          label="GMV"
          value={formatRand(o?.gmvCents ?? 0)}
          trend={delta(o?.gmvCents, o?.gmvCentsPrev)}
          tone="cyan"
        />
        <KpiTile
          label="Revenue"
          value={formatRand(o?.revenueCents ?? 0)}
          trend={delta(o?.revenueCents, o?.revenueCentsPrev)}
          tone="green"
        />
        <KpiTile
          label="Sales"
          value={String(o?.txCount ?? 0)}
          trend={delta(o?.txCount, o?.txCountPrev)}
          tone="purple"
        />
      </div>

      <div className="adm-kpis">
        <KpiTile
          label="Avg order"
          value={formatRand(o?.aovCents ?? 0)}
          trend={delta(o?.aovCents, o?.aovCentsPrev)}
          tone="cyan"
        />
        <KpiTile
          label="Refund rate"
          value={
            typeof o?.refundRate === 'number'
              ? `${(o.refundRate * 100).toFixed(1)}%`
              : '—'
          }
          tone="amber"
        />
        <KpiTile
          label="Dispute rate"
          value={
            typeof o?.disputeRate === 'number'
              ? `${(o.disputeRate * 100).toFixed(1)}%`
              : '—'
          }
          tone="red"
        />
      </div>

      <NeonCard
        tone="cyan"
        title="Sales velocity"
        action={<Pill tone="cyan">{period.toUpperCase()}</Pill>}
      >
        {series.loading && !series.data ? (
          <SkeletonRows rows={1} />
        ) : series.error ? (
          <EmptyState icon="alert" title="Chart unavailable" caption={series.error} />
        ) : points.length === 0 ? (
          <EmptyState title="No sales in this window" />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 3,
                height: 120,
                paddingTop: 8,
              }}
            >
              {points.slice(-45).map((p, i) => {
                const height = Math.max(3, ((p.gmvCents ?? 0) / maxGmv) * 100);
                const isPeak = p.gmvCents === maxGmv;
                return (
                  <div
                    key={`${p.bucket}-${i}`}
                    title={`${new Date(p.bucket).toLocaleDateString('en-ZA')}: ${formatRand(p.gmvCents)}`}
                    style={{
                      flex: 1,
                      height: `${height}%`,
                      minWidth: 3,
                      borderRadius: 3,
                      background: isPeak
                        ? 'var(--adm-cyan)'
                        : 'rgba(0, 240, 255, 0.35)',
                      boxShadow: isPeak
                        ? '0 0 14px var(--adm-cyan) !important'
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
            <div className="adm-spread">
              <span className="adm-sub">
                {points.length > 0
                  ? new Date(points[0].bucket).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                    })
                  : ''}
              </span>
              <span className="adm-sub" style={{ color: 'var(--adm-cyan)' }}>
                Peak {formatRand(maxGmv)}
              </span>
              <span className="adm-sub">
                {points.length > 0
                  ? new Date(points[points.length - 1].bucket).toLocaleDateString(
                      'en-ZA',
                      { day: 'numeric', month: 'short' },
                    )
                  : ''}
              </span>
            </div>
          </>
        )}
      </NeonCard>

      <NeonCard title="Sales by category">
        {byCategory.loading && !byCategory.data ? (
          <SkeletonRows rows={3} />
        ) : byCategory.error ? (
          <EmptyState
            icon="alert"
            title="Breakdown unavailable"
            caption={byCategory.error}
          />
        ) : (byCategory.data ?? []).length === 0 ? (
          <EmptyState title="No released sales in this window" />
        ) : (
          (byCategory.data ?? []).map((row) => (
            <div
              key={row.categoryName}
              className="adm-row"
              style={{ cursor: 'default' }}
            >
              <span className="adm-row-text">
                <span className="adm-row-title">{row.categoryName}</span>
                <span
                  style={{
                    display: 'block',
                    height: 4,
                    marginTop: 4,
                    width: `${Math.max(
                      4,
                      ((row.gmvCents ?? 0) / maxCategoryGmv) * 100,
                    )}%`,
                    borderRadius: 999,
                    background: 'rgba(0, 240, 255, 0.55)',
                  }}
                />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="adm-sub">{row.count} sold</span>
                <span className="adm-mono" style={{ fontWeight: 700 }}>
                  {formatRand(row.gmvCents)}
                </span>
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Top makes & models">
        {topMake.loading && !topMake.data ? (
          <SkeletonRows rows={3} />
        ) : topMake.error ? (
          <EmptyState icon="alert" title="Ranking unavailable" caption={topMake.error} />
        ) : (topMake.data ?? []).length === 0 ? (
          <EmptyState title="Nothing sold yet in this window" />
        ) : (
          (topMake.data ?? []).map((row, i) => (
            <div
              key={`${row.make}-${row.model}-${i}`}
              className="adm-row"
              style={{ cursor: 'default' }}
            >
              <span className="adm-row-text">
                <span className="adm-row-title">
                  {row.make} {row.model}
                </span>
                <span className="adm-row-caption">
                  {row.count} sold · avg {formatRand(row.avgPriceCents)}
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {formatRand(row.gmvCents)}
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}
