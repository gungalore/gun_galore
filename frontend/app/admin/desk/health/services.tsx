'use client';

/**
 * HEALTH — services, jobs, third-party probes and queue depths.
 *
 * ⚠️ TWO COMPONENTS, TWO INDEPENDENT FAILURES, AND THAT IS THE FEATURE. The
 * cron roster and the probe sweep are separate fetches with separate state, so
 * one dead endpoint cannot blank the other. The whole point of splitting the
 * 2,926-line Site board was that eight data sources stayed independently
 * isolated; a shared loading flag here would have undone it in the one section
 * an operator opens during an outage.
 *
 * ⚠️ THESE ARE NOT SERVER VITALS AND MUST NOT BE DRESSED AS THEM. CPU, memory
 * and disk still need Warden on the box and the vitals card above still says
 * so. Everything here has a real source this process can reach today:
 * reachability probes and four Prisma counts.
 *
 * ⚠️ ProbesAndQueues STILL SHARES ONE `Promise.all` AND ONE CATCH ACROSS
 * /admin/health/services AND /admin/health/queues, so a 500 from either loses
 * the failure message for both. That was true on the Site board and it is
 * carried across unchanged rather than quietly fixed: splitting it is a real
 * change to the poll loop and the retry, not a move. The mitigation is the one
 * that already exists — the last good sweep stays on screen, so neither card
 * goes blank — and the FailedRegion's scopeNote says so.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  Button,
  FailedRegion,
  IconAlert,
  IconCheck,
  IconClock,
  IconRefresh,
  Label,
  Tag,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  QUEUE_DESK_HREF,
  SERVICE_CATEGORY_LABEL,
  ago,
  clock,
  fetchCrons,
  fetchQueues,
  fetchServices,
  queueTone,
  type CronRow,
  type QueueRow,
  type ServiceProbe,
} from '../../../../lib/desk-site';
import { Card, Quiet, Row } from './board-bits';

/**
 * Services & jobs — the cron roster.
 *
 * ⚠️ NO "FIXED BY WARDEN" ANNOTATIONS, AND THAT IS NOT AN OVERSIGHT. The
 * design notes a bolt beside a job Warden repaired; nothing on the wire says
 * which job that was. GET /admin/health/crons returns a name, a schedule, a
 * last-run stamp and a status, and inventing the attribution would put
 * Warden's name on a recovery it may not have performed.
 *
 * It keeps its own state and its own failure: a stale reading left on screen
 * during an incident is more use than an empty card.
 */
export function ServicesAndJobs() {
  const [crons, setCrons] = React.useState<CronRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setCrons(await fetchCrons());
      setFailure(null);
    } catch (err) {
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const troubled = crons ? crons.filter((c) => c.status !== 'ok') : [];
  const stale = troubled.filter((c) => c.status === 'stale').length;
  // Troubled first, then the rest — during an incident nobody should scroll.
  const ordered = crons ? [...troubled, ...crons.filter((c) => c.status === 'ok')] : [];
  const shown = all ? ordered : ordered.slice(0, 7);

  return (
    <Card
      label="Services & jobs"
      hint={
        crons
          ? `${crons.length} on the roster · ${stale ? `${stale} stale` : 'none stale'} · showing ${shown.length}`
          : 'reading…'
      }
      footer="Stale means three times its own cadence has passed since it last finished. Never can be honest on a weekly job and a young box, which is why it is amber and not red."
    >
      {failure ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
          {failure}
        </span>
      ) : null}
      {!crons ? (
        <Quiet>Reading…</Quiet>
      ) : shown.length === 0 ? (
        <Quiet>No jobs on the roster.</Quiet>
      ) : (
        shown.map((c, i) => {
          const Glyph = c.status === 'ok' ? IconCheck : c.status === 'stale' ? IconAlert : IconClock;
          const ink =
            c.status === 'ok' ? 'var(--dk-ok)' : c.status === 'stale' ? 'var(--dk-bad)' : 'var(--dk-warn)';
          return (
            <Row key={c.name} last={i === shown.length - 1}>
              <Glyph size={14} style={{ color: ink }} />
              <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink)', minWidth: 0 }}>
                {c.name}
              </span>
              {c.status === 'ok' ? null : <Tag kind={c.status === 'stale' ? 'bad' : 'warn'}>{c.status}</Tag>}
              <span style={{ flex: 1 }} />
              <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                {clock(c.lastRunAt)}
              </span>
            </Row>
          );
        })
      )}
      {crons && ordered.length > 7 ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
          <Button variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show the first 7' : `Show all ${ordered.length}`}
          </Button>
        </span>
      ) : null}
    </Card>
  );
}

/** Worst first. During an incident the operator should not have to scroll. */
const SERVICE_RANK: Record<ServiceProbe['status'], number> = {
  down: 0,
  degraded: 1,
  unknown: 2,
  'not-configured': 3,
  up: 4,
};

const SERVICE_TAG: Record<ServiceProbe['status'], 'ok' | 'warn' | 'bad' | 'neutral'> = {
  up: 'ok',
  degraded: 'warn',
  down: 'bad',
  unknown: 'neutral',
  'not-configured': 'neutral',
};

/** Re-probe cadence. Matches the legacy page and sits under every cron. */
const HEALTH_POLL_MS = 60_000;

export function ProbesAndQueues() {
  const [services, setServices] = React.useState<ServiceProbe[] | null>(null);
  const [queues, setQueues] = React.useState<QueueRow[] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [probedAt, setProbedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Only here to re-render the "probed 40s ago" line between sweeps.
  const [, setTick] = React.useState(0);
  // Each probe is bounded at 5s server-side, so a slow sweep must not have a
  // second one pile up behind it.
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const [s, q] = await Promise.all([fetchServices(), fetchQueues()]);
      setServices(s);
      setQueues(q);
      setProbedAt(new Date().toISOString());
      setFailure(null);
    } catch (err) {
      // ⚠️ THE LAST GOOD READING STAYS ON SCREEN. Blanking the cards because
      // one refresh 500d throws away the only picture of the incident, at the
      // moment it is most wanted.
      setFailure(describeFailure(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), HEALTH_POLL_MS);
    const clockTick = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(clockTick);
    };
  }, [load]);

  const ranked = services
    ? [...services].sort(
        (a, b) => SERVICE_RANK[a.status] - SERVICE_RANK[b.status] || a.name.localeCompare(b.name),
      )
    : [];
  const down = ranked.filter((s) => s.status === 'down').length;
  const degraded = ranked.filter((s) => s.status === 'degraded').length;
  const unconfigured = ranked.filter((s) => s.status === 'not-configured').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Label>Third parties and queues</Label>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
          {probedAt ? `probed ${ago(probedAt)}, again every 60s` : 'probing…'}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" icon={IconRefresh} loading={busy} onClick={() => void load()}>
          Probe now
        </Button>
      </div>

      {failure ? (
        <FailedRegion
          title="Couldn't finish the last probe sweep"
          detail={failure}
          onRetry={() => void load()}
          scopeNote={
            probedAt
              ? 'the readings below are from the last good sweep — services and queues share one sweep, so this covers both'
              : 'only this region failed'
          }
        />
      ) : null}

      <Card
        label="Services"
        hint={services ? `${down} down · ${degraded} degraded · ${unconfigured} not configured` : 'probing…'}
        footer="Reachability only, five-second timeout each. Not configured means the key was never supplied, so the feature is off rather than broken."
      >
        {!services ? (
          <Quiet>Probing…</Quiet>
        ) : ranked.length === 0 ? (
          <Quiet>No services are probed.</Quiet>
        ) : (
          ranked.map((s, i) => (
            <Row key={s.name} last={i === ranked.length - 1}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{s.name}</span>
                <span className="dk-mono" style={{ fontSize: 10.5, color: 'var(--dk-ink-3)' }}>
                  {SERVICE_CATEGORY_LABEL[s.category]}
                  {s.detail ? ` · ${s.detail}` : ''}
                </span>
              </span>
              <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                {s.latencyMs === null ? '—' : `${s.latencyMs}ms`}
              </span>
              <Tag kind={SERVICE_TAG[s.status]} icon={s.status === 'up' ? null : undefined}>
                {s.status}
              </Tag>
            </Row>
          ))
        )}
      </Card>

      <Card
        label="Queues"
        hint="work waiting to be done"
        footer="Counts, not a worklist. What actually needs a decision arrives as a card on the Desk."
      >
        {!queues ? (
          <Quiet>Reading…</Quiet>
        ) : (
          queues.map((q, i) => {
            const tone = queueTone(q);
            // ⚠️ The href the server sends points into the panel being
            // deleted, so it is translated. No Desk destination, no link — a
            // dead link during an incident costs more than a plain row.
            const to = q.href ? QUEUE_DESK_HREF[q.href] : undefined;
            return (
              <Row key={q.label} last={i === queues.length - 1}>
                <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', minWidth: 0, flex: 1 }}>
                  {to ? (
                    <Link href={to} style={{ color: 'var(--dk-ink)', textDecoration: 'none' }}>
                      {q.label}
                    </Link>
                  ) : (
                    q.label
                  )}
                </span>
                <span className="dk-mono" style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
                  {q.count}
                </span>
                <Tag kind={tone} icon={tone === 'ok' ? null : undefined}>
                  {tone === 'ok' ? 'clear' : tone === 'warn' ? 'building' : 'over'}
                </Tag>
              </Row>
            );
          })
        )}
      </Card>
    </div>
  );
}
