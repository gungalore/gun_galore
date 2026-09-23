'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ActionRow,
  EmptyState,
  Icon,
  KpiTile,
  NeonCard,
  Pill,
  SkeletonRows,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  formatRand,
  formatWhen,
  wardenBoard,
  wardenChat,
  type ActivityEvent,
  type AlertCount,
  type AttentionQueue,
  type CronStatus,
  type ServiceProbe,
  type TodayPulse,
  type QueueDepth,
} from '@/lib/admin-api';

const TONE_BY_STATUS: Record<ServiceProbe['status'], AdminTone> = {
  up: 'green',
  degraded: 'amber',
  down: 'red',
  'not-configured': 'muted',
  unknown: 'muted',
};

export default function WardenPage() {
  const queue = useAdminPoll<AttentionQueue>(
    () => adminFetch<AttentionQueue>('/admin/command/attention-queue'),
    15_000,
  );
  const pulse = useAdminPoll<TodayPulse>(
    () => adminFetch<TodayPulse>('/admin/command/today-pulse'),
    30_000,
  );
  const alerts = useAdminPoll<AlertCount>(
    () => adminFetch<AlertCount>('/admin/alerts/count'),
    30_000,
  );
  const services = useAdminPoll<ServiceProbe[]>(
    () => adminFetch<ServiceProbe[]>('/admin/health/services'),
    30_000,
  );
  const crons = useAdminPoll<CronStatus[]>(
    () => adminFetch<CronStatus[]>('/admin/health/crons'),
    60_000,
  );
  const queues = useAdminPoll<QueueDepth[]>(
    () => adminFetch<QueueDepth[]>('/admin/health/queues'),
    30_000,
  );
  const activity = useAdminPoll<ActivityEvent[]>(
    () => adminFetch<ActivityEvent[]>('/admin/command/activity-feed?limit=12'),
    30_000,
  );

  const q = queue.data;

  const attention = useMemo(() => {
    if (!q) return [];
    const rows: Array<{
      label: string;
      caption: string;
      count: number;
      /** Omitted where no board addresses this queue — a dead link is worse. */
      href?: string;
      tone: AdminTone;
      icon: Parameters<typeof ActionRow>[0]['icon'];
    }> = [
      {
        label: 'Listings awaiting review',
        caption: 'Regulated or flagged stock held out of the catalogue',
        count: q.pendingListings,
        href: '/admin/operate',
        tone: 'amber',
        icon: 'doc',
      },
      {
        label: 'Seller verifications stalled',
        caption: 'Identity started but not finished more than 24h ago',
        count: q.kycStalled,
        href: '/admin/people',
        tone: 'cyan',
        icon: 'users',
      },
      {
        label: 'Firearm dealer verifications waiting',
        caption: 'SAPS 534 / stock register needs a human decision — money held',
        count: q.dealerVerificationsPendingReview,
        href: '/admin/money',
        tone: 'red',
        icon: 'shield',
      },
      {
        label: 'Disputed payments',
        caption: 'Buyer and seller in dispute — funds frozen mid-flow',
        count: q.disputedPayments,
        href: '/admin/money',
        tone: 'red',
        icon: 'alert',
      },
      {
        label: 'Dispatch SLA at risk',
        caption: 'Paid more than 24h ago and still not dispatched',
        count: q.dispatchSlaAtRisk,
        href: '/admin/money',
        tone: 'amber',
        icon: 'truck',
      },
      {
        label: 'Sales awaiting seller acceptance',
        caption: 'Buyer paid, seller past the 48h accept window',
        count: q.salesAwaitingAccept,
        href: '/admin/money',
        tone: 'amber',
        icon: 'clock',
      },
      {
        label: 'Unresolved alerts',
        caption: 'Ops alerts raised by crons, webhooks and payments',
        count: q.unresolvedAlerts,
        href: '/admin/operate',
        tone: alerts.data?.urgent ? 'red' : 'amber',
        icon: 'flag',
      },
      {
        label: 'Services below alarm threshold',
        caption: 'Prepaid rail running toward empty (SMS, media, AI)',
        count: q.creditsBelowAlarm,
        // ⚠️ NO LINK. This pointed at /admin/insights, whose flag table was
        // removed — the only surface that ever addressed service balances. The
        // count stays visible until a credits board exists to land on.
        tone: 'amber',
        icon: 'server',
      },
    ];
    return rows.filter((r) => r.count > 0);
  }, [q, alerts.data?.urgent]);

  const urgentTotal = attention.reduce((sum, r) => sum + r.count, 0);
  const overall: AdminTone = queue.error
    ? 'red'
    : urgentTotal === 0
      ? 'green'
      : attention.some((r) => r.tone === 'red')
        ? 'red'
        : 'amber';

  const staleCrons = (crons.data ?? []).filter((c) => c.status !== 'ok');
  const okCronCount = (crons.data ?? []).length - staleCrons.length;

  return (
    <>
      {/* ── Headline ─────────────────────────────────────────────── */}
      <NeonCard
        tone={overall}
        title={
          <>
            <span
              style={{
                color:
                  overall === 'green'
                    ? 'var(--adm-green)'
                    : overall === 'amber'
                      ? 'var(--adm-amber)'
                      : 'var(--adm-red)',
              }}
            >
              ●
            </span>{' '}
            Warden status
          </>
        }
        action={
          <Pill tone={overall}>
            {queue.error
              ? 'CONNECTION LOST'
              : urgentTotal === 0
                ? 'ALL CLEAR'
                : `${urgentTotal} ${urgentTotal === 1 ? 'ITEM' : 'ITEMS'}`}
          </Pill>
        }
      >
        <p
          style={{
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.35,
            margin: 0,
          }}
        >
          {queue.error
            ? 'The panel cannot reach the API. Figures below may be stale.'
            : urgentTotal === 0
              ? 'Nothing needs you right now. Money rails, jobs and services are in order.'
              : `${urgentTotal} ${urgentTotal === 1 ? 'item needs' : 'items need'} human review. Everything else is running normally.`}
        </p>
        <p className="adm-sub" style={{ margin: 0 }}>
          {pulse.data
            ? `${pulse.data.salesCount} sales and ${pulse.data.newListings} new listings since midnight.`
            : 'Loading today’s activity…'}
        </p>
      </NeonCard>

      {/* ── Today ────────────────────────────────────────────────── */}
      <div className="adm-kpis">
        <KpiTile
          label="Today GMV"
          value={formatRand(pulse.data?.gmvCents ?? 0)}
          trend="released"
          tone="cyan"
        />
        <KpiTile
          label="Sales"
          value={String(pulse.data?.salesCount ?? 0)}
          trend="since 00:00 SAST"
          tone="green"
        />
        <KpiTile
          label="New users"
          value={String(pulse.data?.newUsers ?? 0)}
          trend="today"
          tone="purple"
        />
      </div>

      {/* ── Attention ────────────────────────────────────────────── */}
      <NeonCard
        tone={urgentTotal > 0 ? 'amber' : undefined}
        title="Needs you"
        action={
          <Pill tone={urgentTotal > 0 ? 'amber' : 'green'}>
            {urgentTotal > 0 ? `${urgentTotal} PENDING` : 'CLEAR'}
          </Pill>
        }
      >
        {queue.loading && !q ? (
          <SkeletonRows rows={3} />
        ) : queue.error ? (
          <EmptyState
            icon="alert"
            title="Could not read the attention queue"
            caption={queue.error}
          />
        ) : attention.length === 0 ? (
          <EmptyState
            title="No open work"
            caption="New items appear here the moment a queue opens."
          />
        ) : (
          attention.map((row) =>
            row.href ? (
              <Link
                key={row.label}
                href={row.href}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <ActionRow
                  icon={row.icon}
                  tone={row.tone}
                  title={row.label}
                  caption={row.caption}
                  trailing={
                    <>
                      <Pill tone={row.tone}>{row.count}</Pill>
                      <Icon name="chevron" size={14} />
                    </>
                  }
                />
              </Link>
            ) : (
              <ActionRow
                key={row.label}
                icon={row.icon}
                tone={row.tone}
                title={row.label}
                caption={row.caption}
                trailing={<Pill tone={row.tone}>{row.count}</Pill>}
              />
            ),
          )
        )}
      </NeonCard>

      {/* ── Warden daemon ────────────────────────────────────────── */}
      <WardenDaemonCard />

      {/* ── Services ─────────────────────────────────────────────── */}
      <NeonCard
        title="Service probes"
        action={
          <Pill
            tone={
              (services.data ?? []).every((s) => s.status === 'up')
                ? 'green'
                : 'amber'
            }
          >
            {(services.data ?? []).filter((s) => s.status === 'up').length}/
            {(services.data ?? []).length} UP
          </Pill>
        }
      >
        {services.loading && !services.data ? (
          <SkeletonRows rows={4} />
        ) : services.error ? (
          <EmptyState icon="alert" title="Probes unavailable" caption={services.error} />
        ) : (
          <div className="adm-grid-2">
            {(services.data ?? []).map((probe) => (
              <ActionRow
                key={probe.name}
                icon="server"
                tone={TONE_BY_STATUS[probe.status]}
                title={probe.name}
                caption={
                  probe.status === 'not-configured'
                    ? 'not configured'
                    : probe.detail ??
                      (probe.latencyMs != null
                        ? `${probe.latencyMs}ms`
                        : probe.status)
                }
                trailing={
                  <Pill tone={TONE_BY_STATUS[probe.status]}>
                    {probe.status === 'not-configured'
                      ? 'OFF'
                      : probe.status.toUpperCase()}
                  </Pill>
                }
              />
            ))}
          </div>
        )}
      </NeonCard>

      {/* ── Jobs ─────────────────────────────────────────────────── */}
      <NeonCard
        title="Scheduled jobs"
        action={
          <Pill tone={staleCrons.length === 0 ? 'green' : 'amber'}>
            {staleCrons.length === 0
              ? `${okCronCount} OK`
              : `${okCronCount} OK · ${staleCrons.length} OWED`}
          </Pill>
        }
      >
        {crons.loading && !crons.data ? (
          <SkeletonRows rows={3} />
        ) : crons.error ? (
          <EmptyState icon="alert" title="Job health unavailable" caption={crons.error} />
        ) : staleCrons.length === 0 ? (
          <EmptyState
            title="Every scheduled job has run on time"
            caption="Overdue jobs raise an alert automatically."
          />
        ) : (
          staleCrons.slice(0, 8).map((cron) => (
            <ActionRow
              key={cron.name}
              icon="clock"
              tone={cron.status === 'stale' ? 'amber' : 'muted'}
              title={cron.name}
              caption={
                cron.status === 'never'
                  ? 'Never recorded a run'
                  : `Last ran ${formatWhen(cron.lastRunAt)} · expected every ${Math.round(
                      cron.expectedIntervalSec / 60,
                    )}m`
              }
              trailing={
                <Pill tone={cron.status === 'stale' ? 'amber' : 'muted'}>
                  {cron.status.toUpperCase()}
                </Pill>
              }
            />
          ))
        )}
      </NeonCard>

      {/* ── Queues ───────────────────────────────────────────────── */}
      <NeonCard title="Work queues">
        {queues.loading && !queues.data ? (
          <SkeletonRows rows={3} />
        ) : queues.error ? (
          <EmptyState icon="alert" title="Queue depths unavailable" caption={queues.error} />
        ) : (
          (queues.data ?? []).map((depth) => {
            const tone: AdminTone =
              depth.count >= depth.thresholdAlarm
                ? 'red'
                : depth.count >= depth.thresholdWarn
                  ? 'amber'
                  : 'green';
            return (
              <ActionRow
                key={depth.label}
                icon="layers"
                tone={tone}
                title={depth.label}
                caption={`warn at ${depth.thresholdWarn} · alarm at ${depth.thresholdAlarm}`}
                trailing={<Pill tone={tone}>{depth.count}</Pill>}
              />
            );
          })
        )}
      </NeonCard>

      {/* ── Activity ─────────────────────────────────────────────── */}
      <NeonCard title="Recent activity">
        {activity.loading && !activity.data ? (
          <SkeletonRows rows={4} />
        ) : activity.error ? (
          <EmptyState icon="alert" title="Activity unavailable" caption={activity.error} />
        ) : (activity.data ?? []).length === 0 ? (
          <EmptyState title="Nothing has happened yet today" />
        ) : (
          (activity.data ?? []).map((event) => (
            <div key={event.id} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-left">
                <span
                  className="adm-icon"
                  data-tone={event.urgent ? 'red' : 'cyan'}
                  style={{ width: 30, height: 30 }}
                >
                  <Icon name="bolt" size={14} />
                </span>
                <span className="adm-row-text">
                  <span className="adm-row-title">{event.title}</span>
                  {event.subtitle ? (
                    <span className="adm-row-caption">{event.subtitle}</span>
                  ) : null}
                </span>
              </span>
              <span
                className="adm-mono"
                style={{ fontSize: 10.5, color: 'var(--adm-ink-2)', flexShrink: 0 }}
              >
                {formatWhen(event.occurredAt)}
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}

/**
 * The standalone daemon's card.
 *
 * ⚠️ HONEST ABOUT ABSENCE. `not_deployed` (nothing configured, so nothing can
 * be waiting) and `unreachable` (configured but silent — nothing was read) are
 * opposite facts and must not render the same; a quiet Warden and an unwell one
 * look identical and mean the opposite of each other. The full thread, the
 * proposals and the controls live on /admin/warden/daemon.
 *
 * 🚨 AND A FAILED READ IS NOT A HEALTHY WARDEN. A 404/500/timeout used to fall
 * through to the "connected, nothing is red" arm because the data was null —
 * the exact signature failure this project keeps hitting: a surface that renders
 * as though something is behind it. `chat.error` is checked FIRST and the card
 * says so out loud.
 */
function WardenDaemonCard() {
  const chat = useAdminPoll(() => wardenChat(), 30_000);
  const board = useAdminPoll(() => wardenBoard(), 30_000);

  const c = chat.data;
  const b = board.data?.board ?? null;
  const absence = c?.absence ?? null;
  const openProposals = c?.proposals.filter((p) => p.status === 'pending').length ?? 0;
  const bad = b?.counts.bad ?? 0;
  const warn = b?.counts.warn ?? 0;
  const errored = chat.error !== null || board.error !== null;

  const tone: AdminTone = errored
    ? 'red'
    : absence === 'unreachable'
      ? 'red'
      : c?.paused
        ? 'amber'
        : 'purple';

  const summary = errored
    ? `Could not read the daemon: ${chat.error ?? board.error}.`
    : absence === 'not_deployed'
      ? 'No daemon is wired. Set WARDEN_BASE_URL and WARDEN_TOKEN on the box to connect it.'
      : absence === 'unreachable'
        ? 'The daemon is configured but did not answer. This is not a reading of the box.'
        : c?.paused
          ? `Paused until ${formatWhen(c.paused.until)}. Measurement continues.`
          : bad > 0
            ? `${bad} fault${bad === 1 ? '' : 's'} need a human decision.`
            : warn > 0
              ? `${warn} warning${warn === 1 ? '' : 's'} on the board.`
              : 'The box is measured and nothing is red.';

  const pillLabel = errored
    ? 'READ FAILED'
    : absence === 'not_deployed'
      ? 'NOT DEPLOYED'
      : absence === 'unreachable'
        ? 'UNREACHABLE'
        : 'CONNECTED';

  return (
    <NeonCard
      tone={tone}
      title={
        <>
          <span style={{ color: 'var(--adm-purple)' }}>◈</span> Warden daemon
        </>
      }
      action={
        <Pill tone={errored ? 'red' : absence === 'not_deployed' ? 'muted' : absence ? 'red' : 'purple'}>
          {pillLabel}
        </Pill>
      }
    >
      {chat.loading && !c && !chat.error ? (
        <SkeletonRows rows={2} />
      ) : (
        <>
          <p className="adm-sub" style={{ margin: 0 }}>
            {summary}
          </p>
          {!errored && absence === null ? (
            <p className="adm-sub" style={{ marginTop: 6 }}>
              {openProposals > 0
                ? `${openProposals} proposal${openProposals === 1 ? '' : 's'} awaiting your decision.`
                : 'Nothing is waiting on a decision.'}{' '}
              Last swept {formatWhen(c?.lastCheckAt)}.
            </p>
          ) : null}
          <Link
            href="/admin/warden/daemon"
            style={{ textDecoration: 'none', display: 'block', marginTop: 12 }}
          >
            <span className="adm-btn" data-tone="purple" style={{ width: '100%' }}>
              {openProposals > 0 ? `Review ${openProposals} proposal${openProposals === 1 ? '' : 's'}` : 'Open the daemon'}
              <Icon name="chevron" size={14} />
            </span>
          </Link>
        </>
      )}
    </NeonCard>
  );
}
