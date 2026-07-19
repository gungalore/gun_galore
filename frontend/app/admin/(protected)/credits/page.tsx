'use client';

// External-service credit monitor — /admin/credits.
//
// Operator-facing dashboard for SMSPortal, VerifyNow, Cloudinary,
// Anthropic and Pudo credit/balance pools. Backed by:
//   - GET /admin/credits/snapshot         live fetch (5s timeout each)
//   - GET /admin/credits/history          per-service trend data
//   - GET /admin/credits/thresholds       current alert thresholds
//   - PUT /admin/credits/thresholds/:srv  upsert one threshold
//   - POST /admin/credits/:srv/test       cheap probe (non-billing)
//
// The 15-min cron (TasksService.pollCreditBalances) writes a snapshot
// row per service per tick — the trend chart and the attention queue
// both feed off that table. This page never blocks on the live snapshot
// API; the live fetch is for an "as of right now" view.
//
// Auth pattern matches /admin/health: client-component-only, hits
// adminFetch(), bails to /admin/login when the JWT is missing.

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminSection as Section } from '@/components/admin/section';

// ─── Types matching backend response shapes ───────────────────────

interface SnapshotResult {
  service: 'smsportal' | 'verifynow' | 'cloudinary' | 'anthropic' | 'pudo';
  balance: number | null;
  unit: string | null;
  metadata: Record<string, unknown> | null;
  fetchedAt: string;
  error?: string;
}

interface HistoryPoint {
  id: string;
  service: string;
  balance: number | null;
  unit: string | null;
  fetchedAt: string;
  error: string | null;
}

interface Threshold {
  id: string;
  service: string;
  warnThreshold: number | null;
  alarmThreshold: number | null;
  lastWarnAlertAt: string | null;
  lastAlarmAlertAt: string | null;
  enabled: boolean;
  updatedAt: string;
}

// Stable order — matches the order the backend returns from fetchAll().
const SERVICE_ORDER: SnapshotResult['service'][] = [
  'smsportal',
  'verifynow',
  'cloudinary',
  'anthropic',
  'pudo',
];

// Pretty labels for cards + threshold editor.
const SERVICE_LABEL: Record<SnapshotResult['service'], string> = {
  smsportal: 'SMSPortal',
  verifynow: 'VerifyNow',
  cloudinary: 'Cloudinary',
  anthropic: 'Anthropic',
  pudo: 'Pudo',
};

// One-line "what does this service do" so the operator remembers why
// they care about each pool dropping.
const SERVICE_DESCRIPTION: Record<SnapshotResult['service'], string> = {
  smsportal: 'Outbound SMS — OTPs, dispatch nudges, win alerts.',
  verifynow: 'KYC — Home Affairs ID lookup + face match.',
  cloudinary: 'Image storage + transformations for every listing.',
  anthropic: 'Claude listing-review agent. Balance = USD spend in last 24h.',
  pudo: 'Locker-to-locker parcel shipping (sold listings).',
};

// ─── Formatters ────────────────────────────────────────────────────

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString('en-ZA');
  return n.toFixed(2);
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

// Status dot based on the most recent fetch result + threshold compare.
// Returns:
//   'ok'           — green dot, balance comfortably above threshold
//   'warn'         — amber dot, balance ≤ warnThreshold
//   'alarm'        — red dot, balance ≤ alarmThreshold OR fetch errored
//   'unconfigured' — grey dot, service not wired up yet
function statusFor(
  snap: SnapshotResult,
  threshold: Threshold | undefined,
): 'ok' | 'warn' | 'alarm' | 'unconfigured' {
  if (snap.error?.includes('not configured')) return 'unconfigured';
  // Services with NO balance API (Anthropic admin API off, Pudo, TCG
  // post-paid) can't be auto-checked — that's a known limitation, not an
  // emergency, so they render grey "not configured" instead of red.
  // A null balance with any OTHER error is a real probe failure → alarm.
  if (
    snap.balance == null &&
    /no (public )?balance endpoint|may not be enabled|post-paid/i.test(
      snap.error ?? '',
    )
  ) {
    return 'unconfigured';
  }
  if (snap.balance == null) return 'alarm';
  if (
    threshold?.alarmThreshold != null &&
    snap.balance <= threshold.alarmThreshold
  ) {
    return 'alarm';
  }
  if (
    threshold?.warnThreshold != null &&
    snap.balance <= threshold.warnThreshold
  ) {
    return 'warn';
  }
  return 'ok';
}

const STATUS_COLOR: Record<string, string> = {
  ok: '#22c55e',
  warn: '#f59e0b',
  alarm: 'var(--red)',
  unconfigured: 'var(--text-tertiary)',
};

// ─── Page ──────────────────────────────────────────────────────────

export default function AdminCreditsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotResult[] | null>(null);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Initial load — live snapshot + thresholds + 30-day history per
  // service. The history fan-out is N+1ish (one request per service)
  // but with 5 services and indexed reads it stays well under a
  // second. We're paying for the simplicity of "one request, one
  // chart" rather than a server-side aggregate.
  async function loadAll() {
    const [snapRes, thrRes] = await Promise.all([
      adminFetch('/admin/credits/snapshot'),
      adminFetch('/admin/credits/thresholds'),
    ]);
    const snapData: SnapshotResult[] = snapRes.ok ? await snapRes.json() : [];
    const thrData: Threshold[] = thrRes.ok ? await thrRes.json() : [];
    setSnapshots(snapData);
    setThresholds(thrData);

    const histEntries: [string, HistoryPoint[]][] = await Promise.all(
      SERVICE_ORDER.map(async (svc): Promise<[string, HistoryPoint[]]> => {
        const r = await adminFetch(
          `/admin/credits/history?service=${svc}&days=30`,
        );
        return [svc, r.ok ? await r.json() : []];
      }),
    );
    setHistory(Object.fromEntries(histEntries));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!requireAdminToken()) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function thresholdFor(svc: string): Threshold | undefined {
    return thresholds.find((t) => t.service === svc);
  }

  // Refresh button — re-runs the entire pipeline (live fetch + history
  // re-pull) so the chart reflects whatever the cron has written since
  // the page first loaded.
  async function handleRefresh() {
    setRefreshing(true);
    await loadAll();
  }

  // Derived counts for the header strip.
  const alarmCount =
    snapshots?.filter((s) => statusFor(s, thresholdFor(s.service)) === 'alarm')
      .length ?? 0;
  const warnCount =
    snapshots?.filter((s) => statusFor(s, thresholdFor(s.service)) === 'warn')
      .length ?? 0;
  const unconfiguredCount =
    snapshots?.filter(
      (s) => statusFor(s, thresholdFor(s.service)) === 'unconfigured',
    ).length ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1
          className="text-lg font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          Service credits
        </h1>
        <div className="flex items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {loading ? 'Loading...' : 'Live snapshot · cron polls every 15 min'}
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="text-xs px-3 py-1.5 rounded-[6px]"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: refreshing
                ? 'var(--text-tertiary)'
                : 'var(--text-primary)',
              cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {/* Headline summary strip — mirrors /admin/health's pattern */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label="Services below alarm"
          value={alarmCount}
          tone={alarmCount > 0 ? 'alarm' : 'ok'}
        />
        <SummaryCard
          label="Services below warn"
          value={warnCount}
          tone={warnCount > 0 ? 'warn' : 'ok'}
        />
        <SummaryCard
          label="Not configured"
          value={unconfiguredCount}
          tone="ok"
        />
        <SummaryCard
          label="Total monitored"
          value={snapshots?.length ?? 0}
          tone="ok"
        />
      </div>

      {/* ─── Current balance grid ──────────────────────────────── */}
      <Section
        title="Current balances"
        subtitle="Click any card to expand and edit thresholds + fire a non-billing test probe."
      >
        {!snapshots ? (
          <Empty
            message={loading ? 'Loading...' : 'Could not load live snapshots.'}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {snapshots.map((s) => {
              const thr = thresholdFor(s.service);
              const status = statusFor(s, thr);
              const isOpen = expanded === s.service;
              return (
                <BalanceCard
                  key={s.service}
                  snapshot={s}
                  threshold={thr}
                  status={status}
                  open={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : s.service)}
                  onThresholdSaved={(updated) => {
                    setThresholds((prev) => {
                      const without = prev.filter(
                        (t) => t.service !== updated.service,
                      );
                      return [...without, updated];
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </Section>

      {/* ─── 30-day trend per service ───────────────────────────── */}
      <Section
        title="30-day balance trend"
        subtitle="One inline chart per service. Hover any point for the exact value."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SERVICE_ORDER.map((svc) => (
            <TrendChart key={svc} service={svc} points={history[svc] ?? []} />
          ))}
        </div>
      </Section>

      {/* ─── Recent alerts derived from snapshots ───────────────── */}
      <Section
        title="Recent threshold breaches"
        subtitle="Derived from CreditSnapshot rows that fell at/below their alarm threshold."
      >
        <AlertHistory thresholds={thresholds} history={history} />
      </Section>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────

function BalanceCard({
  snapshot,
  threshold,
  status,
  open,
  onToggle,
  onThresholdSaved,
}: {
  snapshot: SnapshotResult;
  threshold: Threshold | undefined;
  status: 'ok' | 'warn' | 'alarm' | 'unconfigured';
  open: boolean;
  onToggle: () => void;
  onThresholdSaved: (t: Threshold) => void;
}) {
  const dotColor = STATUS_COLOR[status];

  return (
    <div
      className="rounded-[8px]"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${status === 'alarm' ? 'var(--red)' : status === 'warn' ? '#f59e0b' : 'var(--border)'}`,
      }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-4"
        style={{ cursor: 'pointer', background: 'transparent', border: 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: dotColor }}
              />
              <p
                className="text-sm font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {SERVICE_LABEL[snapshot.service]}
              </p>
            </div>
            <p
              className="text-3xl"
              style={{
                color:
                  status === 'alarm'
                    ? 'var(--red)'
                    : snapshot.balance == null
                      ? 'var(--text-tertiary)'
                      : 'var(--text-primary)',
                fontWeight: 500,
                letterSpacing: '-0.02em',
              }}
            >
              {fmtNum(snapshot.balance)}
              {snapshot.unit && snapshot.balance != null && (
                <span
                  className="text-xs ml-1"
                  style={{
                    color: 'var(--text-tertiary)',
                    fontWeight: 400,
                    letterSpacing: 0,
                  }}
                >
                  {snapshot.unit}
                </span>
              )}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {SERVICE_DESCRIPTION[snapshot.service]}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Fetched {ago(snapshot.fetchedAt)}
              {threshold && (
                <>
                  {' · warn '}
                  {threshold.warnThreshold ?? '—'}
                  {' · alarm '}
                  {threshold.alarmThreshold ?? '—'}
                </>
              )}
            </p>
            {snapshot.error && (
              <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
                {snapshot.error}
              </p>
            )}
          </div>
          <span
            className="text-xs shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {open ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {open && (
        <ExpandedCard
          snapshot={snapshot}
          threshold={threshold}
          onThresholdSaved={onThresholdSaved}
        />
      )}
    </div>
  );
}

function ExpandedCard({
  snapshot,
  threshold,
  onThresholdSaved,
}: {
  snapshot: SnapshotResult;
  threshold: Threshold | undefined;
  onThresholdSaved: (t: Threshold) => void;
}) {
  const [warn, setWarn] = useState<string>(
    threshold?.warnThreshold != null ? String(threshold.warnThreshold) : '',
  );
  const [alarm, setAlarm] = useState<string>(
    threshold?.alarmThreshold != null ? String(threshold.alarmThreshold) : '',
  );
  const [enabled, setEnabled] = useState<boolean>(threshold?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function save() {
    setSaving(true);
    const body = {
      warnThreshold: warn.trim() === '' ? null : parseFloat(warn),
      alarmThreshold: alarm.trim() === '' ? null : parseFloat(alarm),
      enabled,
    };
    const res = await adminFetch(
      `/admin/credits/thresholds/${snapshot.service}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      const updated: Threshold = await res.json();
      onThresholdSaved(updated);
    }
    setSaving(false);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const res = await adminFetch(`/admin/credits/${snapshot.service}/test`, {
      method: 'POST',
    });
    if (res.ok) {
      const data: { ok: boolean; detail: string } = await res.json();
      setTestResult(`${data.ok ? '✓' : '✗'} ${data.detail}`);
    } else {
      setTestResult('Request failed');
    }
    setTesting(false);
  }

  return (
    <div
      className="p-4 border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }}
    >
      {/* Threshold editor */}
      <p
        className="text-xs uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Alert thresholds
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Warn (email)
          <input
            type="number"
            value={warn}
            onChange={(e) => setWarn(e.target.value)}
            placeholder="—"
            className="block w-full mt-1 px-2 py-1.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Alarm (email + SMS)
          <input
            type="number"
            value={alarm}
            onChange={(e) => setAlarm(e.target.value)}
            placeholder="—"
            className="block w-full mt-1 px-2 py-1.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--red)',
              color: 'var(--text-primary)',
            }}
          />
        </label>
      </div>
      <label
        className="text-xs flex items-center gap-2 mb-3"
        style={{ color: 'var(--text-secondary)' }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Alerts enabled
      </label>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={save}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-[6px]"
          style={{
            background: 'var(--red)',
            color: '#fff',
            border: 0,
            cursor: saving ? 'wait' : 'pointer',
            fontWeight: 500,
          }}
        >
          {saving ? 'Saving…' : 'Save thresholds'}
        </button>
        <button
          onClick={runTest}
          disabled={testing}
          className="text-xs px-3 py-1.5 rounded-[6px]"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
            cursor: testing ? 'wait' : 'pointer',
          }}
        >
          {testing ? 'Testing…' : 'Run test probe'}
        </button>
      </div>
      {testResult && (
        <p
          className="text-xs mb-3"
          style={{
            color: testResult.startsWith('✓') ? '#22c55e' : 'var(--red)',
          }}
        >
          {testResult}
        </p>
      )}

      {/* Raw response from the live snapshot — collapsed by default
          on the card; the operator can copy-paste to debug. */}
      <p
        className="text-xs uppercase tracking-wider mb-1 mt-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Raw response
      </p>
      <pre
        className="text-[10px] p-2 rounded-[4px] overflow-auto"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-secondary)',
          maxHeight: 160,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {JSON.stringify(snapshot.metadata ?? snapshot, null, 2)}
      </pre>
    </div>
  );
}

function TrendChart({
  service,
  points,
}: {
  service: SnapshotResult['service'];
  points: HistoryPoint[];
}) {
  // Filter out null-balance rows for the line (errored fetches) but
  // keep the count for the empty-state message.
  const visible = points.filter((p) => p.balance != null);

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {SERVICE_LABEL[service]}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {visible.length} points
        </p>
      </div>
      {visible.length === 0 ? (
        <div
          className="p-6 text-center rounded-[6px]"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px dashed var(--border)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No snapshots yet. The 15-min cron will start filling this chart once
            it runs.
          </p>
        </div>
      ) : (
        <InlineLineSvg points={visible} />
      )}
    </div>
  );
}

// Pure-SVG line chart. Hand-rolled for parity with /admin/analytics
// rather than pulling in Recharts. Hover tooltips via native `<title>`.
function InlineLineSvg({ points }: { points: HistoryPoint[] }) {
  const W = 480;
  const H = 140;
  const padX = 8;
  const padY = 8;

  // Defensive — Math.max with no args = -Infinity which breaks scaling.
  const balances = points.map((p) => p.balance ?? 0);
  const maxBal = Math.max(...balances, 1);
  const minBal = Math.min(...balances, 0);
  const range = Math.max(1, maxBal - minBal);

  const xStep = points.length > 1 ? (W - 2 * padX) / (points.length - 1) : 0;
  const yScale = (v: number) =>
    H - padY - ((v - minBal) / range) * (H - 2 * padY);
  const xScale = (i: number) => padX + i * xStep;

  const path = points
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.balance ?? 0)}`,
    )
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Baseline */}
      <line
        x1={padX}
        x2={W - padX}
        y1={H - padY}
        y2={H - padY}
        stroke="var(--border)"
        strokeWidth={0.5}
      />
      <path
        d={path}
        fill="none"
        stroke="var(--red)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={p.id}
          cx={xScale(i)}
          cy={yScale(p.balance ?? 0)}
          r={1.5}
          fill="var(--red)"
        >
          <title>
            {new Date(p.fetchedAt).toLocaleString('en-ZA')} —{' '}
            {fmtNum(p.balance)} {p.unit ?? ''}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function AlertHistory({
  thresholds,
  history,
}: {
  thresholds: Threshold[];
  history: Record<string, HistoryPoint[]>;
}) {
  // Walk the per-service history rows, and for each one mark whether
  // the balance fell at/below the alarm threshold AT THE TIME the row
  // was written. Threshold edits happen rarely — we use the current
  // threshold as a proxy for the historical one, which is good enough
  // for an "approximately when did we breach" list. Last 20 events.
  type Breach = {
    service: string;
    balance: number;
    unit: string | null;
    threshold: number;
    fetchedAt: string;
  };
  const breaches: Breach[] = [];
  for (const t of thresholds) {
    if (t.alarmThreshold == null) continue;
    const rows = history[t.service] ?? [];
    for (const p of rows) {
      if (p.balance != null && p.balance <= t.alarmThreshold) {
        breaches.push({
          service: t.service,
          balance: p.balance,
          unit: p.unit,
          threshold: t.alarmThreshold,
          fetchedAt: p.fetchedAt,
        });
      }
    }
  }
  breaches.sort(
    (a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
  );
  const recent = breaches.slice(0, 20);

  if (recent.length === 0) {
    return (
      <div
        className="rounded-[8px] p-6 text-center"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px dashed var(--border)',
        }}
      >
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          No alarm-threshold breaches in the last 30 days. Set thresholds on
          each service to enable breach detection.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
            <Th>Service</Th>
            <Th>Balance</Th>
            <Th>Threshold</Th>
            <Th>When</Th>
          </tr>
        </thead>
        <tbody>
          {recent.map((b, i) => (
            <tr
              key={`${b.service}-${b.fetchedAt}-${i}`}
              style={
                i < recent.length - 1
                  ? { borderBottom: '0.5px solid var(--border)' }
                  : undefined
              }
            >
              <td
                className="px-4 py-2.5"
                style={{ color: 'var(--text-primary)' }}
              >
                {SERVICE_LABEL[b.service as SnapshotResult['service']] ??
                  b.service}
              </td>
              <td
                className="px-4 py-2.5"
                style={{ color: 'var(--red)', fontWeight: 500 }}
              >
                {fmtNum(b.balance)} {b.unit ?? ''}
              </td>
              <td
                className="px-4 py-2.5 text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                ≤ {b.threshold}
              </td>
              <td
                className="px-4 py-2.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {ago(b.fetchedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Shared chrome (mirrors /admin/health) ────────────────────────

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'alarm';
}) {
  const colour =
    tone === 'alarm'
      ? 'var(--red)'
      : tone === 'warn'
        ? '#f59e0b'
        : 'var(--text-primary)';
  const border =
    tone === 'alarm'
      ? 'var(--red)'
      : tone === 'warn'
        ? '#f59e0b'
        : 'var(--border)';
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${border}`,
      }}
    >
      <p
        className="text-2xl font-medium"
        style={{ color: colour, letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-xs uppercase px-4 py-2 text-left"
      style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
    >
      {children}
    </th>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div
      className="rounded-[8px] p-6 text-center"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px dashed var(--border)',
      }}
    >
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {message}
      </p>
    </div>
  );
}
