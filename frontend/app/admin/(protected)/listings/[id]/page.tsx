'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';

// ─── Types ───────────────────────────────────────────────────────────

interface ListingDossier {
  listing: {
    id: string;
    referenceNumber: string | null;
    title: string;
    description: string;
    price: number | null;
    reservePrice: number | null;
    buyNowPrice: number | null;
    listingType: string;
    status: string;
    condition: string;
    province: string;
    isFirearm: boolean;
    make: string | null;
    model: string | null;
    calibre: string | null;
    currentBid: number | null;
    bidCount: number;
    reserveMet: boolean;
    startTime: string | null;
    endTime: string | null;
    durationDays: number | null;
    endedAt: string | null;
    autoAcceptThreshold: number | null;
    isFeatured: boolean;
    passFeeToBuyer: boolean;
    shippingMethods: string[];
    claudeDecision: string | null;
    claudeConfidence: number | null;
    claudeReasons: string[];
    claudeReviewedAt: string | null;
    claudeOriginalDescription: string | null;
    claudeAutoFixApplied: boolean;
    adminReviewedById: string | null;
    adminReviewedAt: string | null;
    adminOverrideReason: string | null;
    expiresAt: string | null;
    soldAt: string | null;
    createdAt: string;
    seller: {
      id: string;
      username: string | null;
      email: string;
      sellerTier: string;
      kycStatus: string;
      trustScore: number;
    };
    category: { id: string; name: string; isFirearm: boolean };
    images: { id: string; url: string; order: number; isPrimary: boolean }[];
    _count: { offers: number; bids: number; watchers: number };
  };
  offers: {
    id: string;
    offerAmount: number;
    counterAmount: number | null;
    buyerNote: string | null;
    sellerNote: string | null;
    status: string;
    createdAt: string;
    buyer: { id: string; username: string | null };
  }[];
  bids: {
    id: string;
    amount: number;
    maxAmount: number;
    isWinner: boolean;
    createdAt: string;
    bidder: { id: string; username: string | null };
  }[];
  watchers: {
    id: string;
    createdAt: string;
    user: { id: string; username: string | null };
  }[];
  transactions: {
    id: string;
    paymentStatus: string;
    shippingStatus: string | null;
    buyerTotal: number;
    sellerPayout: number;
    createdAt: string;
    paidAt: string | null;
    releasedAt: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    buyer: { id: string; username: string | null };
  }[];
  auditEvents: {
    id: string;
    action: string;
    oldValue: string | null;
    newValue: string | null;
    reason: string;
    createdAt: string;
    adminUser: { email: string };
  }[];
  questions: {
    id: string;
    question: string;
    answer: string | null;
    status: string;
    questionDecision: string | null;
    questionReason: string | null;
    reportedCount: number;
    createdAt: string;
    asker: { username: string | null };
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRand(cents: number | null): string {
  if (cents === null) return '—';
  return `R${(cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#22c55e',
  PENDING_REVIEW: '#f59e0b',
  SOLD: '#3b82f6',
  CANCELLED: 'var(--text-tertiary)',
  EXPIRED: 'var(--text-tertiary)',
  DRAFT: 'var(--text-tertiary)',
  PAYMENT_PENDING: '#f59e0b',
  HELD: '#f59e0b',
  RELEASED: '#22c55e',
  REFUNDED: '#6366f1',
  DISPUTED: 'var(--red)',
  APPROVE: '#22c55e',
  AUTO_FIX_AND_APPROVE: '#22c55e',
  REJECT: 'var(--red)',
  HUMAN_REVIEW: '#f59e0b',
  PENDING: '#f59e0b',
  ACCEPTED: '#22c55e',
  REJECTED: 'var(--text-tertiary)',
  COUNTERED: '#3b82f6',
  WITHDRAWN: 'var(--text-tertiary)',
  ANSWERED_BY_SELLER: '#22c55e',
  AUTO_ANSWERED: '#3b82f6',
  AWAITING_SELLER_ANSWER: '#f59e0b',
  REJECTED_BY_MODERATION: 'var(--red)',
};

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'var(--text-tertiary)';
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full inline-block"
      style={{ color, background: `${color}18` }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function ListingDossierPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [d, setD] = useState<ListingDossier | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/admin/listings/${id}/dossier`);
        if (cancelled) return;
        if (res.ok) setD((await res.json()) as ListingDossier);
        else setD(null);
      } catch {
        if (!cancelled) setD(null);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!loaded) {
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      </div>
    );
  }

  if (!d) {
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Listing not found.
        </p>
      </div>
    );
  }

  const l = d.listing;
  const primaryImage = l.images.find((i) => i.isPrimary) ?? l.images[0];

  return (
    <div>
      <Link
        href="/admin/listings"
        className="text-xs inline-block mb-4"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← All listings
      </Link>

      {/* ─── Header strip ──────────────────────────────────────── */}
      <div
        className="rounded-[8px] p-5 mb-5"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex items-start gap-4 flex-wrap">
          {primaryImage && (
            <img
              src={primaryImage.url}
              alt=""
              className="w-32 h-32 rounded-[6px] object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <StatusChip status={l.status} />
              <StatusChip status={l.listingType} />
              {l.isFeatured && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
                >
                  FEATURED
                </span>
              )}
              {l.referenceNumber && (
                <code
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background: 'var(--bg-inset)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                  }}
                >
                  {l.referenceNumber}
                </code>
              )}
            </div>
            <h1
              className="text-lg font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {l.title}
            </h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Mini label="Price" value={formatRand(l.price)} />
              {l.listingType === 'AUCTION' && (
                <>
                  <Mini label="Current bid" value={formatRand(l.currentBid)} sub={`${l.bidCount} bids`} />
                  <Mini label="Reserve" value={formatRand(l.reservePrice)} sub={l.reserveMet ? 'met' : 'not met'} />
                </>
              )}
              {l.listingType === 'TAKE_A_SHOT' && (
                <Mini label="Auto-accept" value={formatRand(l.autoAcceptThreshold)} />
              )}
              <Mini label="Engagement" value={`${d.offers.length}o · ${d.bids.length}b · ${d.watchers.length}w`} />
              <Mini label="Created" value={formatDate(l.createdAt)} />
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
              <Link
                href={`/admin/users/${l.seller.id}`}
                style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
              >
                Seller: @{l.seller.username ?? 'anonymous'}
              </Link>
              {' · '}{l.seller.sellerTier}
              {' · KYC '}{l.seller.kycStatus}
              {' · Trust '}{l.seller.trustScore}
              {' · '}
              <Link
                href={`/listings/${l.id}`}
                target="_blank"
                style={{ color: 'var(--red)', textDecoration: 'none' }}
              >
                View public →
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* ─── Claude moderation panel ───────────────────────────── */}
      <div
        className="rounded-[8px] p-4 mb-5"
        style={{
          background: 'var(--bg-card)',
          border: `0.5px solid ${
            l.claudeDecision === 'REJECT' ? 'var(--red)' : 'var(--border)'
          }`,
        }}
      >
        <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
          <div>
            <p
              className="text-sm font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              Claude moderation
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Reviewed {formatDateTime(l.claudeReviewedAt)}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {l.claudeDecision && <StatusChip status={l.claudeDecision} />}
            {l.claudeConfidence !== null && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background:
                    l.claudeConfidence >= 0.8
                      ? '#22c55e18'
                      : l.claudeConfidence >= 0.5
                        ? '#f59e0b18'
                        : 'var(--red)18',
                  color:
                    l.claudeConfidence >= 0.8
                      ? '#22c55e'
                      : l.claudeConfidence >= 0.5
                        ? '#f59e0b'
                        : 'var(--red)',
                }}
              >
                {(l.claudeConfidence * 100).toFixed(0)}% confidence
              </span>
            )}
          </div>
        </div>
        {l.claudeReasons.length > 0 && (
          <ul className="text-xs space-y-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
            {l.claudeReasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        )}
        {l.claudeAutoFixApplied && l.claudeOriginalDescription && (
          <details className="text-xs">
            <summary style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }}>
              Auto-fix applied — show original description
            </summary>
            <pre
              className="mt-2 p-3 rounded-[4px] whitespace-pre-wrap"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                fontSize: 11,
              }}
            >
              {l.claudeOriginalDescription}
            </pre>
          </details>
        )}
        {l.adminOverrideReason && (
          <p
            className="text-xs mt-2 p-2 rounded-[4px]"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            Admin override: {l.adminOverrideReason}
          </p>
        )}
      </div>

      {/* ─── Details + description ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Section title="Details">
          <DataList
            rows={[
              ['Category', `${l.category.name}${l.category.isFirearm ? ' (firearm)' : ''}`],
              ['Condition', l.condition],
              ['Province', l.province],
              ['Make', l.make ?? '—'],
              ['Model', l.model ?? '—'],
              ['Calibre', l.calibre ?? '—'],
              ['Shipping methods', l.shippingMethods.join(', ') || '—'],
              ['Pass fee to buyer', l.passFeeToBuyer ? 'Yes' : 'No'],
              ['Expires', formatDateTime(l.expiresAt)],
              ['Sold at', formatDateTime(l.soldAt)],
            ]}
          />
        </Section>
        <Section title="Description">
          <div
            className="rounded-[8px] p-4 text-sm whitespace-pre-wrap"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              maxHeight: 320,
              overflowY: 'auto',
              lineHeight: 1.55,
            }}
          >
            {l.description}
          </div>
        </Section>
      </div>

      {/* ─── Auction-specific: bids ─────────────────────────────── */}
      {l.listingType === 'AUCTION' && d.bids.length > 0 && (
        <Section title={`Bids (${d.bids.length})`} subtitle="Newest first">
          <Table
            head={['Bidder', 'Amount', 'Max (proxy)', 'Won', 'When']}
            rows={d.bids.map((b) => [
              <Link
                key="b"
                href={`/admin/users/${b.bidder.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                @{b.bidder.username ?? 'anon'}
              </Link>,
              formatRand(b.amount),
              <span key="m" style={{ color: 'var(--text-tertiary)' }}>
                {formatRand(b.maxAmount)}
              </span>,
              b.isWinner ? (
                <span key="w" style={{ color: '#22c55e' }}>✓</span>
              ) : (
                <span key="w" style={{ color: 'var(--text-tertiary)' }}>—</span>
              ),
              formatDateTime(b.createdAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Take-a-Shot: offers ─────────────────────────────────── */}
      {d.offers.length > 0 && (
        <Section title={`Offers (${d.offers.length})`} subtitle="Take-a-Shot offers + counters">
          <Table
            head={['Buyer', 'Offer', 'Counter', 'Status', 'When']}
            rows={d.offers.map((o) => [
              <Link
                key="b"
                href={`/admin/users/${o.buyer.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                @{o.buyer.username ?? 'anon'}
              </Link>,
              formatRand(o.offerAmount),
              o.counterAmount !== null ? formatRand(o.counterAmount) : '—',
              <StatusChip key="s" status={o.status} />,
              formatDateTime(o.createdAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Watchers ────────────────────────────────────────────── */}
      {d.watchers.length > 0 && (
        <Section title={`Watchers (${d.watchers.length})`} subtitle="Users watching this listing">
          <div
            className="rounded-[8px] p-3 flex flex-wrap gap-2"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            {d.watchers.slice(0, 30).map((w) => (
              <Link
                key={w.id}
                href={`/admin/users/${w.user.id}`}
                className="text-xs px-2 py-1 rounded-full"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  border: '0.5px solid var(--border)',
                }}
              >
                @{w.user.username ?? 'anon'}
              </Link>
            ))}
            {d.watchers.length > 30 && (
              <span className="text-xs px-2 py-1" style={{ color: 'var(--text-tertiary)' }}>
                + {d.watchers.length - 30} more
              </span>
            )}
          </div>
        </Section>
      )}

      {/* ─── Transactions on this listing ───────────────────────── */}
      {d.transactions.length > 0 && (
        <Section title={`Transactions (${d.transactions.length})`}>
          <Table
            head={['Buyer', 'Total', 'Payout', 'Status', 'Shipping', 'Paid at']}
            rows={d.transactions.map((t) => [
              <Link
                key="b"
                href={`/admin/users/${t.buyer.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                @{t.buyer.username ?? 'anon'}
              </Link>,
              <Link
                key="t"
                href={`/admin/transactions/${t.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {formatRand(t.buyerTotal)}
              </Link>,
              formatRand(t.sellerPayout),
              <StatusChip key="s" status={t.paymentStatus} />,
              t.shippingStatus ? <StatusChip key="sh" status={t.shippingStatus} /> : '—',
              formatDate(t.paidAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Questions ──────────────────────────────────────────── */}
      {d.questions.length > 0 && (
        <Section title={`Q&A (${d.questions.length})`} subtitle="Including moderation-rejected questions for context">
          <div className="space-y-2">
            {d.questions.map((q) => (
              <div
                key={q.id}
                className="rounded-[6px] p-3 text-sm"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                }}
              >
                <div className="flex justify-between items-start gap-2 mb-1">
                  <p style={{ color: 'var(--text-primary)' }}>{q.question}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    {q.reportedCount > 0 && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--red)18', color: 'var(--red)' }}
                      >
                        {q.reportedCount} report{q.reportedCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <StatusChip status={q.status} />
                  </div>
                </div>
                {q.answer && (
                  <p
                    className="text-xs mt-2 pl-3"
                    style={{
                      color: 'var(--text-secondary)',
                      borderLeft: '2px solid var(--border)',
                    }}
                  >
                    {q.answer}
                  </p>
                )}
                {q.questionReason && (
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Mod reason: {q.questionReason}
                  </p>
                )}
                <p
                  className="text-xs mt-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  @{q.asker.username ?? 'anon'} · {formatDate(q.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ─── Audit trail ───────────────────────────────────────── */}
      {d.auditEvents.length > 0 && (
        <Section title={`Admin actions on this listing (${d.auditEvents.length})`}>
          <Table
            head={['When', 'Admin', 'Action', 'Change', 'Reason']}
            rows={d.auditEvents.map((e) => [
              formatDateTime(e.createdAt),
              e.adminUser.email,
              e.action.replace(/_/g, ' '),
              e.oldValue && e.newValue
                ? `${formatJson(e.oldValue)} → ${formatJson(e.newValue)}`
                : '—',
              e.reason,
            ])}
          />
        </Section>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p
        className="uppercase tracking-wider text-[10px]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      <p
        className="text-sm mt-0.5"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        {value}
        {sub && (
          <span
            className="ml-1.5 text-xs"
            style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}
          >
            {sub}
          </span>
        )}
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
    <div className="mb-5">
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

function DataList({ rows }: { rows: [string, string][] }) {
  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className="flex gap-3 px-4 py-2 text-xs"
          style={
            i < rows.length - 1
              ? { borderBottom: '0.5px solid var(--border)' }
              : undefined
          }
        >
          <span style={{ color: 'var(--text-tertiary)', minWidth: 120 }}>{k}</span>
          <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div
      className="rounded-[8px] overflow-x-auto"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
            {head.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-2 text-xs uppercase"
                style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={
                i < rows.length - 1
                  ? { borderBottom: '0.5px solid var(--border)' }
                  : undefined
              }
            >
              {r.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed === 'number' || typeof parsed === 'boolean')
      return String(parsed);
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}
