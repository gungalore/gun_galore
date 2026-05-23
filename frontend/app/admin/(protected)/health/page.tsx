'use client';

// Client-side admin health monitor. Reads JWT from localStorage (via
// lib/admin-auth) and fetches all three probe endpoints in parallel.
// Was originally a server component that read the JWT from a cookie —
// cookie-based auth proved unreliable across browsers, so this page
// (and other admin pages going forward) does its own client-side
// auth + fetch.

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

interface Service {
  name: string;
  url: string;
  category: 'payment' | 'shipping' | 'kyc' | 'media' | 'search' | 'auth' | 'comms';
  status: 'up' | 'degraded' | 'down' | 'not-configured' | 'unknown';
  latencyMs: number | null;
  httpStatus: number | null;
  detail: string | null;
}

interface CronStatus {
  name: string;
  schedule: string;
  lastRunAt: string | null;
  expectedIntervalSec: number;
  status: 'ok' | 'stale' | 'never';
}

interface QueueDepth {
  label: string;
  count: number;
  thresholdWarn: number;
  thresholdAlarm: number;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

const STATUS_COLOR: Record<string, string> = {
  up: '#22c55e',
  ok: '#22c55e',
  degraded: '#f59e0b',
  stale: '#f59e0b',
  down: 'var(--red)',
  never: 'var(--red)',
  'not-configured': 'var(--text-tertiary)',
  unknown: 'var(--text-tertiary)',
};

const CATEGORY_LABEL: Record<Service['category'], string> = {
  payment: 'Payment',
  shipping: 'Shipping',
  kyc: 'KYC',
  media: 'Media',
  search: 'Search',
  auth: 'Auth',
  comms: 'Comms',
};

export default function HealthPage() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [crons, setCrons] = useState<CronStatus[] | null>(null);
  const [queues, setQueues] = useState<QueueDepth[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!requireAdminToken()) return; // redirects if no token

    let cancelled = false;
    (async () => {
      const [sRes, cRes, qRes] = await Promise.all([
        adminFetch('/admin/health/services'),
        adminFetch('/admin/health/crons'),
        adminFetch('/admin/health/queues'),
      ]);
      if (cancelled) return;
      if (sRes.ok) setServices(await sRes.json());
      if (cRes.ok) setCrons(await cRes.json());
      if (qRes.ok) setQueues(await qRes.json());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group services by category for easier visual scanning.
  const byCategory = new Map<string, Service[]>();
  if (services) {
    for (const s of services) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s);
      byCategory.set(s.category, list);
    }
  }

  const downCount = services?.filter((s) => s.status === 'down').length ?? 0;
  const degradedCount =
    services?.filter((s) => s.status === 'degraded').length ?? 0;
  const notConfiguredCount =
    services?.filter((s) => s.status === 'not-configured').length ?? 0;
  const staleCrons = crons?.filter((c) => c.status === 'stale').length ?? 0;
  const neverRunCrons = crons?.filter((c) => c.status === 'never').length ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          System Health
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {loading
            ? 'Loading live probes...'
            : 'Live probes · 5s timeout each · refresh by reloading the page'}
        </p>
      </div>

      {/* Headline summary chip strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label="Services down"
          value={downCount}
          tone={downCount > 0 ? 'alarm' : 'ok'}
        />
        <SummaryCard
          label="Services degraded"
          value={degradedCount}
          tone={degradedCount > 0 ? 'warn' : 'ok'}
        />
        <SummaryCard label="Not configured" value={notConfiguredCount} tone="ok" />
        <SummaryCard
          label={neverRunCrons > 0 ? 'Crons stale / never run' : 'Stale crons'}
          value={staleCrons + neverRunCrons}
          tone={staleCrons > 0 ? 'alarm' : neverRunCrons > 0 ? 'warn' : 'ok'}
        />
      </div>

      {neverRunCrons > 0 && staleCrons === 0 && (
        <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
          ℹ {neverRunCrons} cron{neverRunCrons === 1 ? '' : 's'} haven&apos;t run
          yet — likely the backend restarted recently. They&apos;ll flip to
          &quot;ok&quot; after their next scheduled fire. Hourly jobs may take up
          to 60 min to appear.
        </p>
      )}

      {/* ─── External services ─────────────────────────────────── */}
      <Section
        title="External services"
        subtitle="HEAD/GET probes — any 2xx/4xx response means the host is reachable; 5xx = degraded; timeout = down."
      >
        {!services ? (
          <Empty message={loading ? 'Loading...' : 'Could not load service probes.'} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from(byCategory.entries()).map(([cat, items]) => (
              <div
                key={cat}
                className="rounded-[8px] p-4"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                }}
              >
                <p
                  className="text-xs uppercase tracking-wider mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {CATEGORY_LABEL[cat as Service['category']]}
                </p>
                <div className="space-y-2">
                  {items.map((s) => (
                    <div key={s.name} className="flex items-center gap-3 text-sm">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: STATUS_COLOR[s.status] }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ color: 'var(--text-primary)' }}>
                          {s.name}
                        </p>
                        <p
                          className="text-xs truncate"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {s.detail ?? s.url}
                        </p>
                      </div>
                      <span
                        className="text-xs shrink-0"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {s.latencyMs !== null ? `${s.latencyMs}ms` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ─── Cron status ────────────────────────────────────────── */}
      <Section
        title="Cron jobs"
        subtitle="Each job updates its last-run timestamp on completion. 'Stale' = hasn't run in 3× its expected interval."
      >
        {!crons ? (
          <Empty message={loading ? 'Loading...' : 'Could not load cron status.'} />
        ) : (
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
                  <Th>Job</Th>
                  <Th>Schedule</Th>
                  <Th>Last run</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {crons.map((c, i) => (
                  <tr
                    key={c.name}
                    style={
                      i < crons.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-primary)' }}>
                      {c.name}
                    </td>
                    <td
                      className="px-4 py-2.5 text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {c.schedule}
                    </td>
                    <td
                      className="px-4 py-2.5 text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {ago(c.lastRunAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: `${STATUS_COLOR[c.status]}18`,
                          color: STATUS_COLOR[c.status],
                          fontWeight: 500,
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Queue depths ───────────────────────────────────────── */}
      <Section
        title="Queue depths"
        subtitle="Work waiting to be done. Colour reflects threshold (green / amber / red)."
      >
        {!queues ? (
          <Empty message={loading ? 'Loading...' : 'Could not load queue depths.'} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {queues.map((q) => {
              const tone =
                q.count >= q.thresholdAlarm
                  ? 'alarm'
                  : q.count >= q.thresholdWarn
                    ? 'warn'
                    : 'ok';
              return (
                <SummaryCard
                  key={q.label}
                  label={q.label}
                  value={q.count}
                  tone={tone}
                />
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

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
    tone === 'alarm' ? 'var(--red)' : tone === 'warn' ? '#f59e0b' : 'var(--border)';
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: `0.5px solid ${border}` }}
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
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
      style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {message}
      </p>
    </div>
  );
}
