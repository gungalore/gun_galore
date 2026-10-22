'use client';

import { useMemo, useState } from 'react';
import {
  ActionRow,
  EmptyState,
  KpiTile,
  NeonCard,
  Pill,
  SkeletonRows,
  useAdminToast,
} from '@/components/admin/admin-ui';
import { AdminDrawer } from '@/components/admin/admin-drawer';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  adminFetchBlob,
  analyticsByListingType,
  analyticsDispatchSla,
  analyticsFreshnessGraveyard,
  analyticsInsights,
  analyticsKycFunnel,
  analyticsRefundRisk,
  analyticsTimeToSale,
  formatDuration,
  formatRand,
  formatWhen,
  generateInsightsDigest,
  type ActiveUserRow,
  type AnalyticsOverview,
  type ByCategory,
  type ByListingType,
  type DispatchSlaBucket,
  type DwellBreakdown,
  type FeatureAdoptionRow,
  type FreshnessGraveyardRow,
  type FunnelStage,
  type HeatCell,
  type InsightsDigestRow,
  type InsightsPulse,
  type KycFunnelStage,
  type LoginsSeriesPoint,
  type RefundRiskRow,
  type SearchIntel,
  type TimeSeriesPoint,
  type TimeToSaleRow,
  type TopMakeModel,
  type UserDrilldown,
} from '@/lib/admin-api';

/**
 * INSIGHTS IS THE REVENUE + GROWTH BOARD, NOT A SETTINGS PAGE.
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

const TABS = [
  { id: 'money', label: 'Money & Sales' },
  { id: 'traffic', label: 'Traffic & Time' },
  { id: 'demand', label: 'Demand & Marketing' },
  { id: 'ops', label: 'Ops & Inventory' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function delta(now: number | undefined, prev: number | undefined): string {
  if (typeof now !== 'number' || typeof prev !== 'number' || prev === 0) return '';
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% vs prev`;
}

function bucketFor(period: Period): 'day' | 'week' | 'month' {
  if (period === '90d' || period === '365d') return 'week';
  if (period === 'all') return 'month';
  return 'day';
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [tab, setTab] = useState<TabId>('money');

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

      <div className="adm-scroll-x">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="adm-chip"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'money' && <MoneyTab period={period} />}
      {tab === 'traffic' && <TrafficTab period={period} />}
      {tab === 'demand' && <DemandTab period={period} />}
      {tab === 'ops' && <OpsTab />}
    </>
  );
}

// ── MONEY & SALES ─────────────────────────────────────────────────────

function MoneyTab({ period }: { period: Period }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const bucket = bucketFor(period);

  const overview = useAdminPoll<AnalyticsOverview>(
    () => adminFetch<AnalyticsOverview>(`/admin/analytics/overview?period=${period}`),
    60_000,
    [period],
  );
  const series = useAdminPoll<TimeSeriesPoint[]>(
    () =>
      adminFetch<TimeSeriesPoint[]>(
        `/admin/analytics/time-series?period=${period}&bucket=${bucket}`,
      ),
    120_000,
    [period, bucket],
  );
  const byCategory = useAdminPoll<ByCategory[]>(
    () => adminFetch<ByCategory[]>(`/admin/analytics/by-category?period=${period}`),
    120_000,
    [period],
  );
  const topMake = useAdminPoll<TopMakeModel[]>(
    () =>
      adminFetch<TopMakeModel[]>(`/admin/analytics/top-make-model?period=${period}`),
    120_000,
    [period],
  );
  const byType = useAdminPoll<ByListingType[]>(() => analyticsByListingType(period), 120_000, [
    period,
  ]);
  const timeToSale = useAdminPoll<TimeToSaleRow[]>(() => analyticsTimeToSale(period), 120_000, [
    period,
  ]);

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
  const typeTotal = (byType.data ?? []).reduce((n, r) => n + r.count, 0);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await adminFetchBlob(
        `/admin/analytics/export.csv?period=${period}&bucket=${bucket}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all-outdoor-analytics-${period}-${bucket}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
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
          value={o?.aovCents == null ? '—' : formatRand(o?.aovCents ?? 0)}
          trend={delta(o?.aovCents ?? undefined, o?.aovCentsPrev ?? undefined)}
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
        action={
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            onClick={() => void exportCsv()}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      >
        {exportError ? (
          <p className="adm-sub" style={{ color: 'var(--adm-red)' }}>
            {exportError}
          </p>
        ) : null}
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
                    title={`${new Date(p.bucket).toLocaleDateString('en-ZA')}: ${formatRand(p.gmvCents)} · ${p.txCount ?? 0} sales`}
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

      <NeonCard title="Buy Now vs Auctions">
        {byType.loading && !byType.data ? (
          <SkeletonRows rows={2} />
        ) : byType.error ? (
          <EmptyState icon="alert" title="Split unavailable" caption={byType.error} />
        ) : (byType.data ?? []).length === 0 ? (
          <EmptyState title="Nothing sold in this window" />
        ) : (
          (byType.data ?? []).map((row) => (
            <div key={row.listingType} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">
                  {row.listingType === 'BUY_NOW'
                    ? 'Buy Now'
                    : row.listingType === 'AUCTION'
                      ? 'Auctions'
                      : row.listingType}
                </span>
                <span className="adm-row-caption">
                  {row.count} sold ·{' '}
                  {typeTotal > 0 ? `${Math.round((row.count / typeTotal) * 100)}% of orders` : '—'}
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {formatRand(row.gmvCents)}
              </span>
            </div>
          ))
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

      <NeonCard title="Median time to sale">
        {timeToSale.loading && !timeToSale.data ? (
          <SkeletonRows rows={3} />
        ) : timeToSale.error ? (
          <EmptyState icon="alert" title="Timing unavailable" caption={timeToSale.error} />
        ) : (timeToSale.data ?? []).length === 0 ? (
          <EmptyState title="Not enough sold inventory to measure" />
        ) : (
          (timeToSale.data ?? []).map((row) => (
            <div
              key={row.categoryName}
              className="adm-row"
              style={{ cursor: 'default' }}
            >
              <span className="adm-row-text">
                <span className="adm-row-title">{row.categoryName}</span>
                <span className="adm-row-caption">{row.sold} sold</span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {row.medianDays} days
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}

// ── TRAFFIC & TIME ────────────────────────────────────────────────────

function TrafficTab({ period }: { period: Period }) {
  const [member, setMember] = useState<ActiveUserRow | null>(null);

  const pulse = useAdminPoll<InsightsPulse>(analyticsInsights.pulse, 60_000, []);
  const logins = useAdminPoll<LoginsSeriesPoint[]>(
    () => analyticsInsights.loginsSeries(period),
    120_000,
    [period],
  );
  const dwell = useAdminPoll<DwellBreakdown>(
    () => analyticsInsights.dwell(period),
    120_000,
    [period],
  );
  const activity = useAdminPoll<HeatCell[]>(
    () => analyticsInsights.activityHeatmap(period),
    300_000,
    [period],
  );
  const sales = useAdminPoll<HeatCell[]>(
    () => analyticsInsights.salesHeatmap(period),
    300_000,
    [period],
  );
  const active = useAdminPoll<ActiveUserRow[]>(
    () => analyticsInsights.activeUsers(period),
    120_000,
    [period],
  );

  const p = pulse.data;
  const stickiness =
    p && p.mau > 0 ? Math.round((p.dau / p.mau) * 1000) / 10 : null;
  const series = logins.data ?? [];
  const maxLogins = Math.max(1, ...series.map((s) => s.logins));
  const lastSession = [...series]
    .reverse()
    .find((s) => s.avgSessionSec !== null);
  const d = dwell.data;

  return (
    <>
      <div className="adm-kpis">
        <KpiTile label="DAU" value={String(p?.dau ?? 0)} tone="cyan" />
        <KpiTile label="WAU" value={String(p?.wau ?? 0)} tone="green" />
        <KpiTile label="MAU" value={String(p?.mau ?? 0)} tone="purple" />
      </div>
      <div className="adm-kpis">
        <KpiTile
          label="Stickiness"
          value={stickiness === null ? '—' : `${stickiness}%`}
          tone="amber"
        />
        <KpiTile label="Logins today" value={String(p?.loginsToday ?? 0)} tone="cyan" />
        <KpiTile label="New users 7d" value={String(p?.newUsers7d ?? 0)} tone="green" />
      </div>

      <NeonCard
        tone="cyan"
        title="Daily logins"
        action={<Pill tone="cyan">{period.toUpperCase()}</Pill>}
      >
        {logins.loading && !logins.data ? (
          <SkeletonRows rows={1} />
        ) : logins.error ? (
          <EmptyState icon="alert" title="Logins unavailable" caption={logins.error} />
        ) : series.length === 0 ? (
          <EmptyState title="No sign-ins in this window" />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 2,
                height: 110,
                paddingTop: 8,
              }}
            >
              {series.slice(-60).map((s) => (
                <div
                  key={s.bucket}
                  title={`${s.bucket}: ${s.logins} logins · ${s.uniqueUsers} members · ${s.newUsers} new`}
                  style={{
                    flex: 1,
                    minWidth: 2,
                    height: `${Math.max(2, (s.logins / maxLogins) * 100)}%`,
                    borderRadius: 2,
                    background: 'rgba(0, 255, 136, 0.45)',
                  }}
                />
              ))}
            </div>
            <div className="adm-spread">
              <span className="adm-sub">{series[0]?.bucket}</span>
              <span className="adm-sub" style={{ color: 'var(--adm-green)' }}>
                Peak {maxLogins} logins
              </span>
              <span className="adm-sub">{series[series.length - 1]?.bucket}</span>
            </div>
            {lastSession ? (
              <p className="adm-sub" style={{ margin: 0 }}>
                Average session on {lastSession.bucket}:{' '}
                <strong style={{ color: 'var(--adm-ink)' }}>
                  {formatDuration(lastSession.avgSessionSec)}
                </strong>
              </p>
            ) : null}
          </>
        )}
      </NeonCard>

      <NeonCard
        title="Time spent on what"
        action={
          d ? <Pill tone="purple">{formatDuration(d.totalSeconds)} total</Pill> : undefined
        }
      >
        {dwell.loading && !d ? (
          <SkeletonRows rows={4} />
        ) : dwell.error ? (
          <EmptyState icon="alert" title="Dwell unavailable" caption={dwell.error} />
        ) : !d || d.sections.length === 0 ? (
          <EmptyState
            title="No dwell recorded yet"
            caption="Time is measured per route from the moment members browse after this deploy."
          />
        ) : (
          <>
            <div className="adm-spread">
              <span className="adm-sub">{d.totalVisits} visits</span>
              <span className="adm-sub">
                Avg {formatDuration(d.avgSecondsPerVisit)} per visit
              </span>
            </div>
            {d.sections.map((s) => (
              <div key={s.section} className="adm-row" style={{ cursor: 'default' }}>
                <span className="adm-row-text" style={{ flex: 1 }}>
                  <span className="adm-row-title" style={{ textTransform: 'capitalize' }}>
                    {s.section}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      height: 4,
                      marginTop: 4,
                      width: `${Math.max(3, s.sharePct)}%`,
                      borderRadius: 999,
                      background: 'rgba(176, 38, 255, 0.6)',
                    }}
                  />
                  <span className="adm-row-caption">
                    {s.sharePct}% of time · {s.users} members · avg{' '}
                    {formatDuration(s.avgSeconds)}
                  </span>
                </span>
                <span className="adm-mono" style={{ fontWeight: 700 }}>
                  {formatDuration(s.seconds)}
                </span>
              </div>
            ))}
          </>
        )}
      </NeonCard>

      <NeonCard title="Attention by category">
        {dwell.loading && !d ? (
          <SkeletonRows rows={4} />
        ) : !d || d.categories.length === 0 ? (
          <EmptyState title="Category dwell needs listing visits" />
        ) : (
          d.categories.map((c) => (
            <div key={c.categoryName} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">{c.categoryName}</span>
                <span className="adm-row-caption">
                  {c.views} visits · {c.users} members
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {formatDuration(c.seconds)}
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Most-watched listings">
        {dwell.loading && !d ? (
          <SkeletonRows rows={4} />
        ) : !d || d.topListings.length === 0 ? (
          <EmptyState title="No listing dwell yet" />
        ) : (
          d.topListings.map((l) => (
            <div key={l.listingId} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">{l.title ?? l.listingId}</span>
                <span className="adm-row-caption">
                  {formatRand(l.priceCents ?? 0)} · {l.views} visits · {l.users} members
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {formatDuration(l.seconds)}
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Browsing heatmap (SAST)">
        <Heatmap cells={activity.data ?? []} tone="cyan" />
      </NeonCard>

      <NeonCard title="Sales heatmap (SAST)">
        <Heatmap cells={sales.data ?? []} tone="green" />
      </NeonCard>

      <NeonCard title="Most active members">
        {active.loading && !active.data ? (
          <SkeletonRows rows={4} />
        ) : active.error ? (
          <EmptyState icon="alert" title="Active members unavailable" caption={active.error} />
        ) : (active.data ?? []).length === 0 ? (
          <EmptyState title="No member activity in this window" />
        ) : (
          (active.data ?? []).map((row) => (
            <ActionRow
              key={row.userId}
              icon="users"
              tone="cyan"
              title={row.username ? `@${row.username}` : row.userId.slice(0, 10)}
              caption={`${row.events} events · last seen ${formatWhen(row.lastSeen)}`}
              onClick={() => setMember(row)}
            />
          ))
        )}
      </NeonCard>

      {member ? (
        <MemberDrawer member={member} onClose={() => setMember(null)} />
      ) : null}
    </>
  );
}

function MemberDrawer({
  member,
  onClose,
}: {
  member: ActiveUserRow;
  onClose: () => void;
}) {
  const drill = useAdminPoll<UserDrilldown>(
    () => analyticsInsights.userDrilldown(member.userId),
    60_000,
    [member.userId],
  );
  const u = drill.data;
  const peak = [...(u?.peakHours ?? [])].sort((a, b) => b.value - a.value)[0];

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={member.username ? `@${member.username}` : member.userId.slice(0, 10)}
      subtitle="Member activity"
      badge={`${member.events} EVENTS`}
      badgeTone="cyan"
    >
      {drill.loading && !u ? (
        <SkeletonRows rows={4} />
      ) : drill.error ? (
        <EmptyState icon="alert" title="Drilldown unavailable" caption={drill.error} />
      ) : !u ? (
        <EmptyState title="Nothing to show" />
      ) : (
        <>
          <div className="adm-kpis">
            <KpiTile label="Logins 30d" value={String(u.logins.month)} tone="cyan" />
            <KpiTile label="Logins total" value={String(u.logins.total)} tone="green" />
            <KpiTile
              label="Peak hour"
              value={peak ? `${String(peak.hour).padStart(2, '0')}:00` : '—'}
              tone="purple"
            />
          </div>
          <NeonCard title="Event mix">
            {u.totalsByType.slice(0, 10).map((t) => (
              <div key={t.eventType} className="adm-row" style={{ cursor: 'default' }}>
                <span className="adm-row-text">
                  <span className="adm-row-title">{t.eventType.replace(/_/g, ' ')}</span>
                </span>
                <span className="adm-mono" style={{ fontWeight: 700 }}>
                  {t.count}
                </span>
              </div>
            ))}
          </NeonCard>
          <NeonCard title="Recent trail">
            {u.recent.slice(0, 15).map((r, i) => (
              <div key={`${r.createdAt}-${i}`} className="adm-row" style={{ cursor: 'default' }}>
                <span className="adm-row-text">
                  <span className="adm-row-title">{r.eventType.replace(/_/g, ' ')}</span>
                  <span className="adm-row-caption">
                    {r.query
                      ? `“${r.query}”`
                      : r.listingId
                        ? `listing ${r.listingId.slice(0, 10)}`
                        : formatWhen(r.createdAt)}
                  </span>
                </span>
                <span className="adm-sub">{formatWhen(r.createdAt)}</span>
              </div>
            ))}
          </NeonCard>
        </>
      )}
    </AdminDrawer>
  );
}

// ── DEMAND & MARKETING ────────────────────────────────────────────────

function DemandTab({ period }: { period: Period }) {
  const { isGod } = useAdminSession();
  const { toast } = useAdminToast();
  const [busy, setBusy] = useState(false);

  const digest = useAdminPoll<InsightsDigestRow | null>(
    () => analyticsInsights.digest(),
    300_000,
    [],
  );
  const dormant = useAdminPoll(() => analyticsInsights.dormant(), 300_000, []);
  const funnel = useAdminPoll<FunnelStage[]>(
    () => analyticsInsights.funnel(period),
    120_000,
    [period],
  );
  const search = useAdminPoll<SearchIntel>(
    () => analyticsInsights.search(period),
    300_000,
    [period],
  );
  const adoption = useAdminPoll<FeatureAdoptionRow[]>(
    () => analyticsInsights.featureAdoption(period),
    300_000,
    [period],
  );

  const stages = funnel.data ?? [];
  const maxAdoption = Math.max(1, ...(adoption.data ?? []).map((r) => r.events));

  async function generate() {
    setBusy(true);
    try {
      await generateInsightsDigest();
      digest.refresh();
      toast('Fresh digest generated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not generate', 'red');
    } finally {
      setBusy(false);
    }
  }

  const latest = digest.data;

  return (
    <>
      <div className="adm-kpis">
        <KpiTile label="Dormant (consented)" value={String(dormant.data?.total ?? 0)} tone="amber" />
        <KpiTile label="SMS reachable" value={String(dormant.data?.smsReachable ?? 0)} tone="green" />
        <KpiTile
          label="Unmet searches"
          value={String(
            (search.data?.zeroResult ?? []).reduce((n, t) => n + t.count, 0),
          )}
          tone="purple"
        />
      </div>

      <NeonCard
        tone="purple"
        title="Weekly strategy digest"
        action={
          isGod ? (
            <button
              type="button"
              className="adm-btn"
              data-tone="purple"
              onClick={() => void generate()}
              disabled={busy}
            >
              {busy ? 'Writing…' : 'Generate now'}
            </button>
          ) : undefined
        }
      >
        {digest.loading && !latest ? (
          <SkeletonRows rows={4} />
        ) : digest.error ? (
          <EmptyState icon="alert" title="Digest unavailable" caption={digest.error} />
        ) : !latest ? (
          <EmptyState
            title="No digest yet"
            caption="The Monday 06:00 run writes one automatically."
          />
        ) : (
          <>
            <div className="adm-spread">
              <span className="adm-sub">
                Generated {formatWhen(latest.generatedAt)} · {latest.periodDays}d window
              </span>
              <Pill tone="purple">{latest.model ?? 'no model'}</Pill>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                color: 'var(--adm-ink)',
              }}
            >
              {latest.narrative ??
                'The deterministic stats pack is stored, but the narrative could not be written (the model was unavailable).'}
            </p>
          </>
        )}
      </NeonCard>

      <NeonCard title="Conversion funnel">
        {funnel.loading && !funnel.data ? (
          <SkeletonRows rows={4} />
        ) : funnel.error ? (
          <EmptyState icon="alert" title="Funnel unavailable" caption={funnel.error} />
        ) : stages.length === 0 ? (
          <EmptyState title="No funnel activity in this window" />
        ) : (
          stages.map((stage, i) => {
            const prev = stages[i - 1];
            const drop =
              prev && prev.count > 0
                ? Math.round((stage.count / prev.count) * 100)
                : null;
            return (
              <div key={stage.key} className="adm-row" style={{ cursor: 'default' }}>
                <span className="adm-row-text">
                  <span className="adm-row-title">{stage.label}</span>
                  <span className="adm-row-caption">
                    {stage.users} members
                    {drop !== null ? ` · ${drop}% of previous step` : ''}
                  </span>
                </span>
                <span className="adm-mono" style={{ fontWeight: 700 }}>
                  {stage.count}
                </span>
              </div>
            );
          })
        )}
      </NeonCard>

      <NeonCard title="Top searches">
        {search.loading && !search.data ? (
          <SkeletonRows rows={4} />
        ) : (search.data?.topTerms ?? []).length === 0 ? (
          <EmptyState title="No searches in this window" />
        ) : (
          (search.data?.topTerms ?? []).map((t) => (
            <div key={t.term} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">“{t.term}”</span>
                <span className="adm-row-caption">
                  {t.maxResults ?? 0} results at most
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {t.count}
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Zero-result searches — unmet demand">
        {search.loading && !search.data ? (
          <SkeletonRows rows={4} />
        ) : (search.data?.zeroResult ?? []).length === 0 ? (
          <EmptyState title="Every search found something" />
        ) : (
          (search.data?.zeroResult ?? []).map((t) => (
            <div key={t.term} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">“{t.term}”</span>
                <span className="adm-row-caption">nothing matched</span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700, color: 'var(--adm-amber)' }}>
                {t.count}
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Feature adoption">
        {adoption.loading && !adoption.data ? (
          <SkeletonRows rows={6} />
        ) : adoption.error ? (
          <EmptyState icon="alert" title="Adoption unavailable" caption={adoption.error} />
        ) : (
          (adoption.data ?? []).map((row) => (
            <div key={row.key} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text" style={{ flex: 1 }}>
                <span className="adm-row-title">{row.label}</span>
                <span
                  style={{
                    display: 'block',
                    height: 4,
                    marginTop: 4,
                    width: `${Math.max(2, (row.events / maxAdoption) * 100)}%`,
                    borderRadius: 999,
                    background: 'rgba(0, 240, 255, 0.5)',
                  }}
                />
                <span className="adm-row-caption">{row.users} members</span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {row.events}
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}

// ── OPS & INVENTORY ───────────────────────────────────────────────────

function OpsTab() {
  const kyc = useAdminPoll<KycFunnelStage[]>(() => analyticsKycFunnel(), 300_000, []);
  const sla = useAdminPoll<DispatchSlaBucket[]>(() => analyticsDispatchSla(), 300_000, []);
  const risk = useAdminPoll<RefundRiskRow[]>(() => analyticsRefundRisk(), 300_000, []);
  const graveyard = useAdminPoll<FreshnessGraveyardRow[]>(
    () => analyticsFreshnessGraveyard(),
    300_000,
    [],
  );

  const maxSla = Math.max(1, ...(sla.data ?? []).map((r) => r.count));

  return (
    <>
      <NeonCard title="Seller verification funnel">
        {kyc.loading && !kyc.data ? (
          <SkeletonRows rows={4} />
        ) : kyc.error ? (
          <EmptyState icon="alert" title="KYC funnel unavailable" caption={kyc.error} />
        ) : (
          (kyc.data ?? []).map((stage, i, all) => {
            const prev = all[i - 1];
            const drop =
              prev && prev.count > 0
                ? Math.round((stage.count / prev.count) * 100)
                : null;
            return (
              <div key={stage.stage} className="adm-row" style={{ cursor: 'default' }}>
                <span className="adm-row-text">
                  <span className="adm-row-title">{stage.stage}</span>
                  {drop !== null ? (
                    <span className="adm-row-caption">{drop}% of previous step</span>
                  ) : null}
                </span>
                <span className="adm-mono" style={{ fontWeight: 700 }}>
                  {stage.count}
                </span>
              </div>
            );
          })
        )}
      </NeonCard>

      <NeonCard title="Dispatch SLA">
        {sla.loading && !sla.data ? (
          <SkeletonRows rows={4} />
        ) : sla.error ? (
          <EmptyState icon="alert" title="SLA unavailable" caption={sla.error} />
        ) : (
          (sla.data ?? []).map((row) => (
            <div key={row.bucket} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text" style={{ flex: 1 }}>
                <span className="adm-row-title">{row.bucket}</span>
                <span
                  style={{
                    display: 'block',
                    height: 4,
                    marginTop: 4,
                    width: `${Math.max(2, (row.count / maxSla) * 100)}%`,
                    borderRadius: 999,
                    background:
                      row.bucket === 'breached'
                        ? 'rgba(255, 0, 85, 0.7)'
                        : 'rgba(0, 255, 136, 0.5)',
                  }}
                />
              </span>
              <span className="adm-mono" style={{ fontWeight: 700 }}>
                {row.count}
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Refund-risk sellers">
        {risk.loading && !risk.data ? (
          <SkeletonRows rows={3} />
        ) : risk.error ? (
          <EmptyState icon="alert" title="Risk list unavailable" caption={risk.error} />
        ) : (risk.data ?? []).length === 0 ? (
          <EmptyState title="No seller above the risk line" />
        ) : (
          (risk.data ?? []).map((row) => (
            <div key={row.sellerId} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">
                  {row.username ? `@${row.username}` : row.email}
                </span>
                <span className="adm-row-caption">
                  {row.refundCount}/{row.totalSales} refunded ·{' '}
                  {row.ppDifference.toFixed(1)}pp above baseline
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700, color: 'var(--adm-red)' }}>
                {(row.refundRate * 100).toFixed(1)}%
              </span>
            </div>
          ))
        )}
      </NeonCard>

      <NeonCard title="Freshness graveyard (30d+, zero engagement)">
        {graveyard.loading && !graveyard.data ? (
          <SkeletonRows rows={4} />
        ) : graveyard.error ? (
          <EmptyState icon="alert" title="Graveyard unavailable" caption={graveyard.error} />
        ) : (graveyard.data ?? []).length === 0 ? (
          <EmptyState title="No dead inventory" />
        ) : (
          (graveyard.data ?? []).map((row) => (
            <div key={row.id} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">{row.title}</span>
                <span className="adm-row-caption">
                  {row.categoryName} · {Math.round(row.ageDays)} days ·{' '}
                  {formatRand(row.priceCents ?? 0)}
                </span>
              </span>
              <span className="adm-mono" style={{ fontWeight: 700, color: 'var(--adm-amber)' }}>
                {Math.round(row.staleScore)}
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Heatmap({ cells, tone }: { cells: HeatCell[]; tone: 'cyan' | 'green' }) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(`${c.dow}-${c.hour}`, c.value);
    return m;
  }, [cells]);
  const color =
    tone === 'cyan' ? '0, 240, 255' : '0, 255, 136';

  if (cells.length === 0) {
    return <EmptyState title="No activity in this window" />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 560 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '34px repeat(24, 1fr)',
            gap: 2,
            alignItems: 'center',
          }}
        >
          <span />
          {Array.from({ length: 24 }).map((_, h) => (
            <span
              key={h}
              className="adm-sub"
              style={{ fontSize: 8, textAlign: 'center', fontFamily: 'var(--adm-mono)' }}
            >
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {DOW.map((label, dow) => (
            <FragmentRow
              key={label}
              label={label}
              dow={dow}
              lookup={lookup}
              max={max}
              color={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  label,
  dow,
  lookup,
  max,
  color,
}: {
  label: string;
  dow: number;
  lookup: Map<string, number>;
  max: number;
  color: string;
}) {
  return (
    <>
      <span className="adm-sub" style={{ fontSize: 9 }}>
        {label}
      </span>
      {Array.from({ length: 24 }).map((_, hour) => {
        const value = lookup.get(`${dow}-${hour}`) ?? 0;
        const intensity = value > 0 ? 0.15 + (value / max) * 0.85 : 0;
        return (
          <span
            key={hour}
            title={`${label} ${String(hour).padStart(2, '0')}:00 — ${value}`}
            style={{
              height: 12,
              borderRadius: 2,
              background:
                value > 0
                  ? `rgba(${color}, ${intensity.toFixed(2)})`
                  : 'rgba(255,255,255,0.04)',
            }}
          />
        );
      })}
    </>
  );
}
