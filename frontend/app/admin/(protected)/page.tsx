'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

// ─── Types matching backend response ────────────────────────────────

interface AttentionQueue {
  pendingListings: number;
  pendingPayments: number;
  kycStalled: number;
  dispatchSlaAtRisk: number;
  disputedPayments: number;
  unresolvedAlerts: number;
  feeBypassAttempts7d: number;
}

interface TodayPulse {
  gmvCents: number;
  salesCount: number;
  newUsers: number;
  newListings: number;
}

interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href?: string;
  occurredAt: string;
  urgent?: boolean;
}

// ─── Formatters ─────────────────────────────────────────────────────

function formatRand(cents: number): string {
  const r = cents / 100;
  if (r >= 1_000_000) return `R${(r / 1_000_000).toFixed(2)}M`;
  if (r >= 10_000) return `R${(r / 1_000).toFixed(1)}k`;
  return `R${r.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

// ─── Event-type → icon + colour ─────────────────────────────────────

const EVENT_VISUAL: Record<string, { icon: string; color: string }> = {
  LISTING_PUBLISHED: { icon: '＋', color: '#3b82f6' },
  LISTING_SOLD: { icon: '✓', color: '#22c55e' },
  TRANSACTION_PAID: { icon: '₹', color: '#22c55e' },
  TRANSACTION_RELEASED: { icon: '↗', color: '#22c55e' },
  TRANSACTION_REFUNDED: { icon: '↺', color: '#6366f1' },
  TRANSACTION_DISPUTED: { icon: '!', color: 'var(--red)' },
  USER_REGISTERED: { icon: '◯', color: '#3b82f6' },
  USER_BANNED: { icon: '✕', color: 'var(--red)' },
  KYC_SUBMITTED: { icon: 'ID', color: '#f59e0b' },
  KYC_VERIFIED: { icon: '✓', color: '#22c55e' },
  ADMIN_ACTION: { icon: '⚙', color: 'var(--text-tertiary)' },
  ADMIN_ALERT: { icon: '!', color: '#f59e0b' },
  OFFER_SUBMITTED: { icon: '$', color: '#3b82f6' },
};

// ─── Page ───────────────────────────────────────────────────────────

export default function AdminCommandCenterPage() {
  const [attention, setAttention] = useState<AttentionQueue | null>(null);
  const [pulse, setPulse] = useState<TodayPulse | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      // Parallel-fetch every panel — they're independent and the page
      // can't render anything useful until all three return.
      const [aRes, pRes, evRes] = await Promise.all([
        adminFetch('/admin/command/attention-queue'),
        adminFetch('/admin/command/today-pulse'),
        adminFetch('/admin/command/activity-feed?limit=30'),
      ]);
      if (cancelled) return;
      if (aRes.ok) setAttention(await aRes.json());
      if (pRes.ok) setPulse(await pRes.json());
      if (evRes.ok) setActivity(await evRes.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute the visible attention cards. Each one knows its deep-link,
  // its urgency tier, and whether it has zero rows (we still render
  // zero-state cards but in a calmer tone so the operator can see at
  // a glance that everything is clear).
  type Tone = 'urgent' | 'warn' | 'calm';
  const attentionCards: {
    label: string;
    value: number;
    href: string;
    tone: Tone;
    hint: string;
  }[] = attention
    ? [
        {
          label: 'Pending listings',
          value: attention.pendingListings,
          href: '/admin/listings?status=PENDING_REVIEW',
          tone: attention.pendingListings > 0 ? 'warn' : 'calm',
          hint: 'Awaiting Claude + admin review',
        },
        {
          label: 'Disputed payments',
          value: attention.disputedPayments,
          href: '/admin/transactions?status=DISPUTED',
          tone: attention.disputedPayments > 0 ? 'urgent' : 'calm',
          hint: 'Buyer raised dispute',
        },
        {
          label: 'Pending verification',
          value: attention.pendingPayments,
          href: '/admin/transactions?status=PENDING_ADMIN_VERIFICATION',
          tone: attention.pendingPayments > 0 ? 'warn' : 'calm',
          hint: 'Manual verification needed',
        },
        {
          label: 'Dispatch SLA at risk',
          value: attention.dispatchSlaAtRisk,
          href: '/admin/transactions?status=HELD',
          tone: attention.dispatchSlaAtRisk > 0 ? 'warn' : 'calm',
          hint: 'Paid >24h, not dispatched',
        },
        {
          label: 'KYC stalled',
          value: attention.kycStalled,
          href: '/admin/users?kyc=stalled',
          tone: attention.kycStalled > 0 ? 'warn' : 'calm',
          hint: 'KYC required >24h, not verified',
        },
        {
          label: 'Unresolved alerts',
          value: attention.unresolvedAlerts,
          href: '/admin/audit?resourceType=Alert',
          tone: attention.unresolvedAlerts > 0 ? 'warn' : 'calm',
          hint: 'System-raised flags',
        },
      ]
    : [];

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Command Center
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Live snapshot · refreshes on every page load
        </p>
      </div>

      {/* ─── ATTENTION QUEUE — 6 clickable cards ───────────────── */}
      {attention ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {attentionCards.map((c) => (
            <AttentionCard key={c.label} {...c} />
          ))}
        </div>
      ) : (
        <ErrorBox message="Could not load the attention queue. Backend may be down." />
      )}

      {/* ─── TODAY'S PULSE — 4 KPI cards ─────────────────────────── */}
      <div className="mb-2">
        <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Today's pulse
        </p>
      </div>
      {pulse ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <PulseCard label="GMV today" value={formatRand(pulse.gmvCents)} />
          <PulseCard
            label="Sales today"
            value={pulse.salesCount.toLocaleString('en-ZA')}
          />
          <PulseCard
            label="New listings"
            value={pulse.newListings.toLocaleString('en-ZA')}
          />
          <PulseCard
            label="New users"
            value={pulse.newUsers.toLocaleString('en-ZA')}
          />
        </div>
      ) : null}

      {/* ─── ACTIVITY FEED ───────────────────────────────────────── */}
      <div className="mb-2 flex justify-between items-baseline">
        <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          Recent activity
        </p>
        <Link
          href="/admin/audit"
          className="text-xs"
          style={{ color: 'var(--red)', textDecoration: 'none' }}
        >
          Full audit log →
        </Link>
      </div>
      {activity && activity.length > 0 ? (
        <div
          className="rounded-[8px] overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          {activity.map((e, i) => {
            const visual = EVENT_VISUAL[e.type] ?? { icon: '·', color: 'var(--text-tertiary)' };
            const inner = (
              <div
                className="flex items-start gap-3 px-4 py-2.5"
                style={
                  i < activity.length - 1
                    ? { borderBottom: '0.5px solid var(--border)' }
                    : undefined
                }
              >
                <span
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                  style={{
                    background: `${visual.color}20`,
                    color: visual.color,
                  }}
                >
                  {visual.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm truncate"
                    style={{
                      color: e.urgent ? 'var(--red)' : 'var(--text-primary)',
                      fontWeight: e.urgent ? 500 : 400,
                    }}
                  >
                    {e.title}
                  </p>
                  {e.subtitle && (
                    <p
                      className="text-xs truncate mt-0.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {e.subtitle}
                    </p>
                  )}
                </div>
                <span
                  className="text-xs shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {timeAgo(e.occurredAt)}
                </span>
              </div>
            );
            return e.href ? (
              <Link
                key={e.id}
                href={e.href}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                {inner}
              </Link>
            ) : (
              <div key={e.id}>{inner}</div>
            );
          })}
        </div>
      ) : (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No marketplace activity in the last 7 days yet.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function AttentionCard({
  label,
  value,
  href,
  tone,
  hint,
}: {
  label: string;
  value: number;
  href: string;
  tone: 'calm' | 'warn' | 'urgent';
  hint: string;
}) {
  const accent =
    tone === 'urgent' ? 'var(--red)' : tone === 'warn' ? '#f59e0b' : 'var(--border)';
  const valueColor =
    tone === 'urgent'
      ? 'var(--red)'
      : tone === 'warn'
        ? 'var(--text-primary)'
        : 'var(--text-tertiary)';

  return (
    <Link
      href={href}
      className="rounded-[8px] p-4 block transition-transform hover:scale-[1.02]"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${accent}`,
        textDecoration: 'none',
      }}
    >
      <p
        className="text-2xl font-medium"
        style={{ color: valueColor, letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
      >
        {label}
      </p>
      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        {hint}
      </p>
    </Link>
  );
}

function PulseCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p
        className="text-xl font-medium mt-1"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="rounded-[8px] p-5 mb-6 text-center text-sm"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px dashed var(--border)',
        color: 'var(--text-tertiary)',
      }}
    >
      {message}
    </div>
  );
}
