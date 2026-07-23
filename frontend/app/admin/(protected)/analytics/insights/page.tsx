'use client';

// Admin Insights (Phase 3) — behavioural + login analytics: platform pulse,
// when-users-are-active + when-things-sell heatmaps, search intelligence,
// engagement funnel, and a per-user "big brother" drilldown. Reads the
// /admin/analytics/insights/* endpoints. Self-contained period state so it
// doesn't couple to the URL-driven Sales page.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';
import AnalyticsTabs from '../../analytics-tabs';

const PERIODS = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '365d', label: '12m' },
  { key: 'all', label: 'All' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Pulse {
  dau: number;
  wau: number;
  mau: number;
  loginsToday: number;
  loginsWeek: number;
  activeListings: number;
  newUsers7d: number;
  salesWeek: number;
}
interface HeatCell {
  dow: number;
  hour: number;
  value: number;
}
interface SearchTerm {
  term: string;
  count: number;
  maxResults?: number;
}
interface FunnelStage {
  key: string;
  label: string;
  count: number;
  users: number;
}
interface ActiveUser {
  userId: string;
  username: string | null;
  events: number;
  lastSeen: string;
}
interface Drill {
  userId: string;
  username: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  logins: { day: number; week: number; month: number; total: number };
  peakHours: { hour: number; value: number }[];
  totalsByType: { eventType: string; count: number }[];
  recent: {
    eventType: string;
    listingId: string | null;
    query: string | null;
    createdAt: string;
  }[];
}

// ── inline primitives ───────────────────────────────────────────────
function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p
        className="text-2xl font-semibold mt-1"
        style={{ color: 'var(--text-primary)' }}
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

function Heatmap({
  title,
  subtitle,
  cells,
}: {
  title: string;
  subtitle: string;
  cells: HeatCell[];
}) {
  const max = cells.reduce((m, c) => Math.max(m, c.value), 0);
  const grid = new Map<string, number>();
  for (const c of cells) grid.set(`${c.dow}-${c.hour}`, c.value);
  return (
    <div
      className="rounded-[8px] p-5"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {subtitle} · times in SA (UTC+2)
      </p>
      {max === 0 ? (
        <p className="text-xs py-6" style={{ color: 'var(--text-tertiary)' }}>
          No data in this period yet.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            {/* hour header */}
            <div style={{ display: 'flex', paddingLeft: 34 }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    fontSize: 8,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {h % 3 === 0 ? h : ''}
                </div>
              ))}
            </div>
            {DAYS.map((day, dow) => (
              <div key={dow} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    width: 34,
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {day}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = grid.get(`${dow}-${h}`) ?? 0;
                  const intensity = v === 0 ? 0 : 0.12 + 0.88 * (v / max);
                  return (
                    <div
                      key={h}
                      title={`${day} ${h}:00 — ${v}`}
                      style={{
                        flex: 1,
                        aspectRatio: '1',
                        margin: 1,
                        borderRadius: 2,
                        background:
                          v === 0
                            ? 'var(--bg-inset)'
                            : `rgba(200,16,46,${intensity})`,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Digest {
  generatedAt: string;
  periodDays: number;
  narrative: string | null;
  model: string | null;
}

export default function InsightsPage() {
  const [period, setPeriod] = useState('30d');
  const [digest, setDigest] = useState<Digest | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [salesHeat, setSalesHeat] = useState<HeatCell[]>([]);
  const [actHeat, setActHeat] = useState<HeatCell[]>([]);
  const [search, setSearch] = useState<{
    topTerms: SearchTerm[];
    zeroResult: SearchTerm[];
  } | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [drill, setDrill] = useState<Drill | null>(null);

  const load = useCallback(async () => {
    if (!requireAdminToken()) return;
    const qs = `?period=${period}`;
    const [p, sh, ah, se, fn, au] = await Promise.all([
      adminFetch('/admin/analytics/insights/pulse').then((r) => (r.ok ? r.json() : null)),
      adminFetch(`/admin/analytics/insights/sales-heatmap${qs}`).then((r) => (r.ok ? r.json() : [])),
      adminFetch(`/admin/analytics/insights/activity-heatmap${qs}`).then((r) => (r.ok ? r.json() : [])),
      adminFetch(`/admin/analytics/insights/search${qs}`).then((r) => (r.ok ? r.json() : null)),
      adminFetch(`/admin/analytics/insights/funnel${qs}`).then((r) => (r.ok ? r.json() : [])),
      adminFetch(`/admin/analytics/insights/active-users${qs}`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setPulse(p);
    setSalesHeat(sh);
    setActHeat(ah);
    setSearch(se);
    setFunnel(fn);
    setUsers(au);
  }, [period]);

  const loadDigest = useCallback(async () => {
    if (!requireAdminToken()) return;
    const r = await adminFetch('/admin/analytics/insights/digest');
    if (r.ok) setDigest(await r.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadDigest();
  }, [loadDigest]);

  async function generateNow() {
    setGenBusy(true);
    try {
      const r = await adminFetch('/admin/analytics/insights/digest/generate', {
        method: 'POST',
      });
      if (r.ok) setDigest(await r.json());
    } finally {
      setGenBusy(false);
    }
  }

  async function openUser(id: string) {
    const res = await adminFetch(`/admin/analytics/insights/user/${id}`);
    if (res.ok) setDrill(await res.json());
  }

  const funnelMax = funnel.reduce((m, f) => Math.max(m, f.count), 0) || 1;

  return (
    <div>
      <AnalyticsTabs />
      <AdminPageHeader
        title="Insights"
        description="Behavioural analytics — who's active when, what sells when, what people search for, and per-user activity."
      />

      <div className="flex gap-1.5 mb-5">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: period === p.key ? 'var(--red)' : 'var(--bg-card)',
              color: period === p.key ? '#fff' : 'var(--text-secondary)',
              border: `0.5px solid ${period === p.key ? 'transparent' : 'var(--border)'}`,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Weekly AI digest */}
      <div
        className="rounded-[8px] p-5 mb-6"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--red)',
        }}
      >
        <div className="flex justify-between items-start gap-3 mb-2 flex-wrap">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Weekly digest
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {digest
                ? `Generated ${new Date(digest.generatedAt).toLocaleString('en-ZA')}`
                : 'Auto-generated every Monday 06:00 — or generate one now.'}
            </p>
          </div>
          <button
            onClick={generateNow}
            disabled={genBusy}
            className="px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {genBusy ? 'Generating…' : 'Generate now'}
          </button>
        </div>
        {digest?.narrative ? (
          <p
            className="text-sm whitespace-pre-wrap"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}
          >
            {digest.narrative}
          </p>
        ) : digest ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            The written summary isn&apos;t available (the AI service was
            unreachable or out of credit) — the live numbers below are still
            current. Top up Anthropic credit and re-generate for the narrative.
          </p>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No digest yet — click Generate now for a written summary of the
            data below.
          </p>
        )}
      </div>

      {/* Pulse */}
      {pulse && (
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <Card label="Active today" value={pulse.dau} hint="unique visitors" />
          <Card label="Active this week" value={pulse.wau} />
          <Card label="Active this month" value={pulse.mau} />
          <Card label="Logins today" value={pulse.loginsToday} hint={`${pulse.loginsWeek} this week`} />
          <Card label="New sign-ups" value={pulse.newUsers7d} hint="last 7 days" />
          <Card label="Sales this week" value={pulse.salesWeek} />
          <Card label="Active listings" value={pulse.activeListings} />
        </div>
      )}

      {/* Heatmaps */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Heatmap title="When users are active" subtitle="Activity by day + hour" cells={actHeat} />
        <Heatmap title="When things sell" subtitle="Completed sales by day + hour" cells={salesHeat} />
      </div>

      {/* Funnel + Search */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Engagement funnel</p>
          {funnel.every((f) => f.count === 0) ? (
            <p className="text-xs py-4" style={{ color: 'var(--text-tertiary)' }}>No activity in this period yet.</p>
          ) : (
            <div className="space-y-2">
              {funnel.map((f) => (
                <div key={f.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'var(--text-secondary)' }}>{f.label}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{f.count.toLocaleString()}{f.users > 0 ? ` · ${f.users} ppl` : ''}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-inset)' }}>
                    <div style={{ height: 8, borderRadius: 4, width: `${Math.max(2, (f.count / funnelMax) * 100)}%`, background: 'var(--red)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Top searches</p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>What people look for</p>
          {!search || search.topTerms.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No searches recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {search.topTerms.map((t) => (
                <div key={t.term} className="flex justify-between text-xs">
                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{t.term}</span>
                  <span style={{ color: (t.maxResults ?? 1) === 0 ? 'var(--red)' : 'var(--text-tertiary)' }}>
                    {t.count}{(t.maxResults ?? 1) === 0 ? ' · 0 results' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {search && search.zeroResult.length > 0 && (
            <>
              <p className="text-xs font-medium mt-4 mb-1" style={{ color: 'var(--red)' }}>Searched but found nothing (stock/ad gaps)</p>
              <div className="flex flex-wrap gap-1.5">
                {search.zeroResult.map((t) => (
                  <span key={t.term} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
                    {t.term} ({t.count})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Active users → drilldown */}
      <div className="rounded-[8px] p-5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Most active users — click to drill down</p>
        {users.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No user activity in this period yet.</p>
        ) : (
          <div className="space-y-1">
            {users.map((u) => (
              <button key={u.userId} onClick={() => openUser(u.userId)} className="w-full flex justify-between items-center text-left px-2 py-1.5 rounded" style={{ background: 'var(--bg-inset)' }}>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{u.username ?? u.userId.slice(-8)}</span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.events} events · last {new Date(u.lastSeen).toLocaleDateString('en-ZA')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drilldown modal */}
      {drill && (
        <div
          onClick={() => setDrill(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 20, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{drill.username ?? drill.userId.slice(-8)}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Joined {drill.createdAt ? new Date(drill.createdAt).toLocaleDateString('en-ZA') : '—'} · last login {drill.lastLoginAt ? new Date(drill.lastLoginAt).toLocaleString('en-ZA') : 'never'}
                </p>
              </div>
              <button onClick={() => setDrill(null)} style={{ color: 'var(--text-tertiary)', fontSize: 18, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[['Today', drill.logins.day], ['7 days', drill.logins.week], ['30 days', drill.logins.month], ['All time', drill.logins.total]].map(([l, v]) => (
                <div key={l as string} className="rounded p-2 text-center" style={{ background: 'var(--bg-inset)' }}>
                  <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{v as number}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{l as string} logins</p>
                </div>
              ))}
            </div>
            {drill.totalsByType.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {drill.totalsByType.map((t) => (
                  <span key={t.eventType} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
                    {t.eventType.replace(/_/g, ' ')}: {t.count}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Recent activity</p>
            <div className="space-y-1">
              {drill.recent.map((r, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {r.eventType.replace(/_/g, ' ')}
                    {r.query ? ` "${r.query}"` : ''}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{new Date(r.createdAt).toLocaleString('en-ZA')}</span>
                </div>
              ))}
              {drill.recent.length === 0 && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No recorded activity.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
