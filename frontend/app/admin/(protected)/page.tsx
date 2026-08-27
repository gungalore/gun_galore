'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';

// ─── Types matching backend response ────────────────────────────────

interface AttentionQueue {
  pendingListings: number;
  kycStalled: number;
  dispatchSlaAtRisk: number;
  disputedPayments: number;
  unresolvedAlerts: number;
  feeBypassAttempts7d: number;
  // External-service credits (SMSPortal, VerifyNow, Cloudinary,
  // Anthropic, Pudo) at/below the operator-configured alarm threshold.
  // Alarm-grade — a service running on empty silently breaks user flows.
  creditsBelowAlarm: number;
  // TOK-7 Phase 2 — sales where buyer paid but seller missed the 48h
  // accept window. Flagged by the accept-escalation cron. URGENT.
  salesAwaitingAccept: number;
  // FLOW-F4 (H17) — firearm dealer-verifications awaiting a human decision.
  // Buyer's payment is HELD until approved. URGENT.
  dealerVerificationsPendingReview: number;
  // DD-F3 — house Daily Deals that are stock-ready but still have
  // unbooked/uncollected supplier collections past the deal's
  // shipsInDaysMax window. Populated by the backend ops agent (owns
  // admin-command-center.service.ts). OPTIONAL on purpose: if that
  // field lands under a different key, this stays undefined and the
  // card simply hides rather than crashing the whole dashboard.
  dealFulfilmentAttention?: number;
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
  // Group buckets, in the order they should appear on the dashboard.
  // Payments first (money at stake), then Fulfilment, Verification,
  // Content, and finally cross-cutting Alerts.
  type Group = 'Payments' | 'Fulfilment' | 'Verification' | 'Content' | 'Alerts';
  const GROUP_ORDER: Group[] = [
    'Payments',
    'Fulfilment',
    'Verification',
    'Content',
    'Alerts',
  ];
  const attentionCards: {
    label: string;
    value: number;
    href: string;
    tone: Tone;
    hint: string;
    group: Group;
  }[] = attention
    ? [
        {
          label: 'Pending listings',
          value: attention.pendingListings,
          href: '/admin/listings?status=PENDING_REVIEW',
          tone: attention.pendingListings > 0 ? 'warn' : 'calm',
          hint: 'Awaiting Claude + admin review',
          group: 'Content',
        },
        {
          label: 'Disputed payments',
          value: attention.disputedPayments,
          href: '/admin/transactions?status=DISPUTED',
          tone: attention.disputedPayments > 0 ? 'urgent' : 'calm',
          hint: 'Buyer raised dispute',
          group: 'Payments',
        },
        // ("Pending verification" card removed 2026-07-18 — it counted the
        // old manual-EFT PENDING_ADMIN_VERIFICATION status, which nothing
        // can produce since the EFT strip. Re-add when the new payment
        // rail has a pay-in verification queue.)
        {
          label: 'Dispatch SLA at risk',
          value: attention.dispatchSlaAtRisk,
          href: '/admin/transactions?status=HELD',
          tone: attention.dispatchSlaAtRisk > 0 ? 'warn' : 'calm',
          hint: 'Paid >24h, not dispatched',
          group: 'Fulfilment',
        },
        {
          // FLOW-F4 (H17) — firearm verifications waiting on a human decision.
          label: 'Firearm verifications to review',
          value: attention.dealerVerificationsPendingReview,
          href: '/admin/transactions?status=HELD',
          tone:
            attention.dealerVerificationsPendingReview > 0 ? 'urgent' : 'calm',
          hint: 'Dealer transfer — funds held pending review',
          group: 'Fulfilment',
        },
        // DD-F3 — house-deal supplier collections that are stock-ready but
        // still unbooked/uncollected past the deal's shipsInDaysMax window.
        // Modelled on 'Dispatch SLA at risk' above. Backend field name is
        // ASSUMED `dealFulfilmentAttention` (the ops agent owns
        // admin-command-center.service.ts); wired defensively — the card is
        // only added when the count is present and > 0, so a key mismatch or
        // a not-yet-deployed backend fails safe (no card) instead of showing
        // a stray zero or throwing.
        ...((attention.dealFulfilmentAttention ?? 0) > 0
          ? [
              {
                label: 'Deal fulfilment needs attention',
                value: attention.dealFulfilmentAttention ?? 0,
                href: '/admin/deals',
                tone: 'warn' as Tone,
                hint: 'Supplier collection overdue',
                group: 'Fulfilment' as Group,
              },
            ]
          : []),
        {
          label: 'KYC stalled',
          value: attention.kycStalled,
          href: '/admin/users?kyc=stalled',
          tone: attention.kycStalled > 0 ? 'warn' : 'calm',
          hint: 'KYC required >24h, not verified',
          group: 'Verification',
        },
        {
          label: 'Unresolved alerts',
          value: attention.unresolvedAlerts,
          // The alerts INBOX (was /admin/audit?resourceType=Alert — a
          // filter no audit row ever matches, i.e. a guaranteed-empty
          // page).
          href: '/admin/alerts',
          tone: attention.unresolvedAlerts > 0 ? 'warn' : 'calm',
          hint: 'System-raised flags',
          group: 'Alerts',
        },
        // Contact-detail bypass attempts the filter blocked in the last 7
        // days — the backend always computed this; the card was simply
        // never rendered. Warn-grade: it's evidence of fee-dodging
        // attempts, reviewable on the Trust & Safety page.
        {
          label: 'Fee-bypass attempts (7d)',
          value: attention.feeBypassAttempts7d,
          href: '/admin/trust-safety',
          tone: attention.feeBypassAttempts7d > 0 ? 'warn' : 'calm',
          hint: 'Contact-detail filter blocks',
          group: 'Alerts',
        },
        // Service credits below alarm — silent-failure risk. SMS/email
        // alerts also fire from the cron, but this card keeps the
        // dashboard scan honest in case the operator missed them.
        {
          label: 'Service credits low',
          value: attention.creditsBelowAlarm,
          href: '/admin/credits',
          tone: attention.creditsBelowAlarm > 0 ? 'urgent' : 'calm',
          hint: 'Below alarm threshold',
          group: 'Alerts',
        },
        // TOK-7 Phase 2: stalled sales — buyer paid, seller missed the
        // 48h accept deadline. Urgent because the buyer's money has
        // been held for 2+ days without commitment.
        {
          label: 'Sales awaiting accept',
          value: attention.salesAwaitingAccept,
          href: '/admin/transactions?status=HELD&filter=accept-stalled',
          tone: attention.salesAwaitingAccept > 0 ? 'urgent' : 'calm',
          hint: 'Seller didn’t accept in 48h',
          group: 'Payments',
        },
      ]
    : [];

  // Bucket the cards by group, preserving the GROUP_ORDER and the
  // original card order within each group. Only groups that actually
  // have cards are rendered.
  const groupedCards = GROUP_ORDER.map((group) => ({
    group,
    cards: attentionCards.filter((c) => c.group === group),
  })).filter((g) => g.cards.length > 0);

  return (
    <div>
      <AdminPageHeader
        title="Command Center"
        meta="Live snapshot · refreshes on every page load"
      />

      {/* ─── ATTENTION QUEUE — cards grouped by category ─────────
          The ~11 cards are bucketed under small uppercase sub-headers
          (Payments / Fulfilment / Verification / Content / Alerts) so
          the operator scans a tidy section at a time instead of a flat
          wall. Each group keeps the SAME card grid + styling as before. */}
      {attention ? (
        <div className="mb-6">
          {groupedCards.map(({ group, cards }) => (
            <div key={group} className="mb-5 last:mb-0">
              <p
                className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {group}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {cards.map((c) => (
                  <AttentionCard key={c.label} {...c} />
                ))}
              </div>
            </div>
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
                    background: `color-mix(in srgb, ${visual.color} 13%, transparent)`,
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
  // Cards carry a `group` field for dashboard bucketing; the card itself
  // doesn't render it, but it's accepted here so {...c} spreads cleanly.
  group?: string;
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
