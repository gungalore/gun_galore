'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminSection as Section } from '@/components/admin/section';
import AnalyticsTabs from '../../analytics-tabs';

// Operational Health — second tab on /admin/analytics. Three blocks:
//   1. KYC funnel drop-off
//   2. Dispatch SLA distribution
//   3. Refund risk sellers (≥ 2x marketplace baseline)
// Each pulls its own backend endpoint; render-time SVG / DataList
// keeps the bundle slim.

interface KycStage {
  stage: string;
  count: number;
}

interface DispatchBucket {
  bucket: string;
  count: number;
}

interface RefundRiskSeller {
  sellerId: string;
  username: string | null;
  email: string;
  totalSales: number;
  refundCount: number;
  refundRate: number;
  ppDifference: number;
}

const BUCKET_LABEL: Record<string, string> = {
  'under-24h': 'Under 24h',
  '24-48h': '24–48h',
  '48-72h': '48–72h',
  pending: 'Still pending',
  breached: 'Breached (>72h)',
};

const BUCKET_COLOR: Record<string, string> = {
  'under-24h': '#22c55e',
  '24-48h': '#22c55e',
  '48-72h': '#f59e0b',
  pending: '#f59e0b',
  breached: 'var(--red)',
};

export default function OpsHealthPage() {
  const [funnel, setFunnel] = useState<KycStage[] | null>(null);
  const [sla, setSla] = useState<DispatchBucket[] | null>(null);
  const [risk, setRisk] = useState<RefundRiskSeller[] | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const [fRes, sRes, rRes] = await Promise.all([
        adminFetch('/admin/analytics/kyc-funnel'),
        adminFetch('/admin/analytics/dispatch-sla'),
        adminFetch('/admin/analytics/refund-risk'),
      ]);
      if (cancelled) return;
      if (fRes.ok) setFunnel(await fRes.json());
      if (sRes.ok) setSla(await sRes.json());
      if (rRes.ok) setRisk(await rRes.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
        Operational Health
      </h1>

      <AnalyticsTabs />

      {/* ─── KYC funnel ─────────────────────────────────────────── */}
      <Section
        title="KYC funnel drop-off"
        subtitle="Where sellers stall on the verification journey. Big drops between adjacent stages = friction to fix."
      >
        {!funnel || funnel.length === 0 ? (
          <Empty message="No KYC data yet — no sellers have triggered the flow." />
        ) : (
          <KycFunnelChart stages={funnel} />
        )}
      </Section>

      {/* ─── Dispatch SLA distribution ─────────────────────────── */}
      <Section
        title="Dispatch SLA distribution"
        subtitle="How long sellers take from payment to dispatch confirmation. >72h is a breach (auto-refund cron fires)."
      >
        {!sla || sla.every((b) => b.count === 0) ? (
          <Empty message="No dispatched courier transactions yet." />
        ) : (
          <SlaBarChart buckets={sla} />
        )}
      </Section>

      {/* ─── Refund risk sellers ────────────────────────────────── */}
      <Section
        title="Refund-risk sellers"
        subtitle="Sellers with refund rate ≥ 2× the marketplace baseline (filter: ≥3 sales)."
      >
        {!risk || risk.length === 0 ? (
          <Empty message="No sellers above the risk threshold — healthy marketplace baseline." />
        ) : (
          <RefundRiskTable rows={risk} />
        )}
      </Section>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function KycFunnelChart({ stages }: { stages: KycStage[] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div
      className="rounded-[8px] p-5 space-y-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {stages.map((s, i) => {
        const pct = (s.count / max) * 100;
        const prev = i > 0 ? stages[i - 1].count : null;
        const dropPct =
          prev !== null && prev > 0 ? ((prev - s.count) / prev) * 100 : null;
        return (
          <div key={s.stage}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-secondary)' }}>{s.stage}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {s.count.toLocaleString('en-ZA')}
                {dropPct !== null && dropPct > 0 && (
                  <span style={{ color: dropPct > 30 ? 'var(--red)' : '#f59e0b', marginLeft: 8 }}>
                    −{dropPct.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-inset)' }}
            >
              <div
                className="h-full"
                style={{
                  background: 'var(--red)',
                  width: `${pct}%`,
                  transition: 'width 200ms ease-out',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SlaBarChart({ buckets }: { buckets: DispatchBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div
      className="rounded-[8px] p-5 space-y-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {buckets.map((b) => {
        const pct = total > 0 ? (b.count / total) * 100 : 0;
        return (
          <div key={b.bucket}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-secondary)' }}>
                {BUCKET_LABEL[b.bucket] ?? b.bucket}
              </span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {b.count.toLocaleString('en-ZA')} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-inset)' }}
            >
              <div
                className="h-full"
                style={{
                  background: BUCKET_COLOR[b.bucket] ?? 'var(--text-tertiary)',
                  width: `${pct}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RefundRiskTable({ rows }: { rows: RefundRiskSeller[] }) {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
            <Th>Seller</Th>
            <Th align="right">Sales</Th>
            <Th align="right">Refunds</Th>
            <Th align="right">Rate</Th>
            <Th align="right">vs baseline</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.sellerId}
              style={
                i < rows.length - 1
                  ? { borderBottom: '0.5px solid var(--border)' }
                  : undefined
              }
            >
              <td className="px-4 py-3">
                <Link
                  href={`/admin/users/${r.sellerId}`}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                >
                  @{r.username ?? 'anon'}
                </Link>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {r.email}
                </p>
              </td>
              <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                {r.totalSales}
              </td>
              <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
                {r.refundCount}
              </td>
              <td className="px-4 py-3 text-right text-sm" style={{ color: 'var(--red)', fontWeight: 500 }}>
                {(r.refundRate * 100).toFixed(1)}%
              </td>
              <td className="px-4 py-3 text-right">
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--red-wash)', color: 'var(--red)', fontWeight: 500 }}
                >
                  +{r.ppDifference.toFixed(1)}pp
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className="text-xs uppercase px-4 py-2"
      style={{ color: 'var(--text-tertiary)', fontWeight: 500, textAlign: align }}
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
