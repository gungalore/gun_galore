'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminStatusChip as StatusChip } from '@/components/admin/status-chip';
import UserActions from '../user-actions';

// ─── Types — kept loose because the backend returns a rich object ────
// with optional fields we want to render conditionally. `any`-ish typing
// at the boundary is acceptable here; the backend service is the source
// of truth and we render defensively.

interface Dossier {
  user: {
    id: string;
    clerkId: string;
    email: string;
    username: string | null;
    phone: string | null;
    phoneVerified: boolean;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    addrStreet: string | null;
    addrSuburb: string | null;
    addrCity: string | null;
    addrPostalCode: string | null;
    addrProvince: string | null;
    sellerTier: string;
    subscriptionTier: string;
    trustScore: number;
    averageRating: number | null;
    kycStatus: string;
    kycVerifiedAt: string | null;
    kycRequiredAt: string | null;
    kycAttempts: number;
    kycFaceMatchScore: number | null;
    totalSales: number;
    isBanned: boolean;
    bannedAt: string | null;
    profileCompletedAt: string | null;
    bankName: string | null;
    bankAccountHolder: string | null;
    bankAccountNumber: string | null;
    bankVerifiedAt: string | null;
    createdAt: string;
    _count: {
      listings: number;
      buyerTransactions: number;
      sellerTransactions: number;
      offersPlaced: number;
    };
  };
  listings: {
    id: string;
    referenceNumber: string | null;
    title: string;
    price: number | null;
    listingType: string;
    status: string;
    createdAt: string;
    soldAt: string | null;
    claudeDecision: string | null;
    claudeConfidence: number | null;
    _count: { offers: number; bids: number; watchers: number };
  }[];
  buyerTransactions: {
    id: string;
    paymentStatus: string;
    buyerTotal: number;
    createdAt: string;
    listing: { title: string };
    seller: { username: string | null };
  }[];
  sellerTransactions: {
    id: string;
    paymentStatus: string;
    sellerPayout: number;
    createdAt: string;
    listing: { title: string };
    buyer: { username: string | null };
  }[];
  buyerOffers: {
    id: string;
    offerAmount: number;
    status: string;
    createdAt: string;
    listing: { id: string; title: string };
  }[];
  bids: {
    id: string;
    amount: number;
    createdAt: string;
    isWinner: boolean;
    listing: { id: string; title: string; status: string };
  }[];
  ratingsReceived: {
    id: string;
    stars: number;
    comment: string | null;
    createdAt: string;
    rater: { username: string | null };
  }[];
  ratingsGiven: {
    id: string;
    stars: number;
    comment: string | null;
    createdAt: string;
    rated: { username: string | null; id: string };
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
  systemAlerts: {
    id: string;
    type: string;
    context: string | null;
    urgent: boolean;
    resolved: boolean;
    createdAt: string;
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRand(cents: number | null): string {
  if (cents === null) return '—';
  const r = cents / 100;
  return `R${r.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
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

// Status pills come from the shared <StatusChip> (AdminStatusChip).

// ─── Page ───────────────────────────────────────────────────────────

export default function UserDossierPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [d, setD] = useState<Dossier | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/admin/users/${id}/dossier`);
        if (cancelled) return;
        if (res.ok) setD((await res.json()) as Dossier);
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
          User not found.
        </p>
      </div>
    );
  }

  const u = d.user;
  const initials = (u.username ?? u.email).slice(0, 2).toUpperCase();

  return (
    <div>
      <Link
        href="/admin/users"
        className="text-xs inline-block mb-3"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← Users
      </Link>

      {/* ─── Header strip — identity + ban state + actions ─────── */}
      <div
        className="rounded-[8px] p-5 mb-5 flex items-center gap-4 flex-wrap"
        style={{
          background: 'var(--bg-card)',
          border: `0.5px solid ${u.isBanned ? 'var(--red)' : 'var(--border)'}`,
        }}
      >
        {u.avatarUrl ? (
          <img
            src={u.avatarUrl}
            alt=""
            className="w-14 h-14 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 text-sm font-medium"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
            }}
          >
            {initials}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1
              className="text-lg font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              @{u.username ?? '(no username)'}
            </h1>
            {u.isBanned && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
              >
                BANNED · {formatDate(u.bannedAt)}
              </span>
            )}
            <StatusChip status={u.sellerTier} />
            <StatusChip status={u.kycStatus} />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {u.email}
            {u.phone && ` · ${u.phone}${u.phoneVerified ? ' ✓' : ' (unverified)'}`}
            {' · Joined '}{formatDate(u.createdAt)}
          </p>
        </div>

        <div className="shrink-0">
          <UserActions
            userId={u.id}
            username={u.username}
            isBanned={u.isBanned}
            sellerTier={u.sellerTier}
            kycStatus={u.kycStatus}
            subscriptionTier={u.subscriptionTier}
          />
        </div>
      </div>

      {/* ─── Stat strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Trust score" value={u.trustScore.toString()} sub={`/100`} />
        <StatCard
          label="Avg rating"
          value={u.averageRating?.toFixed(1) ?? '—'}
          sub={`${d.ratingsReceived.length} review${d.ratingsReceived.length === 1 ? '' : 's'}`}
        />
        <StatCard label="Listings" value={u._count.listings.toLocaleString('en-ZA')} sub="all-time" />
        <StatCard
          label="As seller"
          value={u._count.sellerTransactions.toLocaleString('en-ZA')}
          sub={`${u.totalSales.toLocaleString('en-ZA')} completed`}
        />
        <StatCard
          label="As buyer"
          value={u._count.buyerTransactions.toLocaleString('en-ZA')}
          sub={`${u._count.offersPlaced.toLocaleString('en-ZA')} offers made`}
        />
      </div>

      {/* ─── System alerts (red surface for this specific user) ─── */}
      {d.systemAlerts.length > 0 && (
        <Section title="System alerts" subtitle="Flags raised against this user">
          <div className="space-y-2">
            {d.systemAlerts.map((a) => (
              <div
                key={a.id}
                className="rounded-[6px] p-3 text-sm"
                style={{
                  background: 'var(--bg-card)',
                  border: `0.5px solid ${a.urgent ? 'var(--red)' : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span style={{ color: a.urgent ? 'var(--red)' : 'var(--text-primary)', fontWeight: 500 }}>
                    {a.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {formatDateTime(a.createdAt)}
                  </span>
                </div>
                {a.context && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {a.context}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ─── Two-column layout: ID/profile + KYC/banking ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Section title="Identity" subtitle="Profile + contact details">
          <DataList
            rows={[
              ['Real name', [u.firstName, u.lastName].filter(Boolean).join(' ') || '—'],
              ['Username', u.username ? `@${u.username}` : '—'],
              ['Email', u.email],
              ['Phone', u.phone ? `${u.phone}${u.phoneVerified ? ' ✓' : ' (unverified)'}` : '—'],
              [
                'Address',
                [u.addrStreet, u.addrSuburb, u.addrCity, u.addrPostalCode, u.addrProvince]
                  .filter(Boolean)
                  .join(', ') || '—',
              ],
              ['Clerk ID', u.clerkId],
              ['Profile completed', formatDate(u.profileCompletedAt)],
            ]}
          />
        </Section>

        <Section title="KYC & banking" subtitle="Verification journey + payout readiness">
          <DataList
            rows={[
              ['KYC status', u.kycStatus],
              ['Required at', formatDateTime(u.kycRequiredAt)],
              ['Verified at', formatDateTime(u.kycVerifiedAt)],
              ['Face-match attempts', u.kycAttempts.toString()],
              [
                'Face-match score',
                u.kycFaceMatchScore !== null
                  ? `${(u.kycFaceMatchScore * 100).toFixed(1)}%`
                  : '—',
              ],
              ['Bank', u.bankName ?? '—'],
              ['Account holder', u.bankAccountHolder ?? '—'],
              [
                'Account number',
                u.bankAccountNumber
                  ? `••••${u.bankAccountNumber.slice(-4)}`
                  : '—',
              ],
              ['AVS verified', formatDateTime(u.bankVerifiedAt)],
            ]}
          />
        </Section>
      </div>

      {/* ─── Listings table ────────────────────────────────────── */}
      {d.listings.length > 0 && (
        <Section
          title={`Listings (${d.listings.length})`}
          subtitle="All listings by this seller, newest first"
        >
          <Table
            head={['Title', 'Type', 'Status', 'Price', 'Engagement', 'Created']}
            rows={d.listings.map((l) => [
              <Link
                key="t"
                href={`/admin/listings/${l.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {l.title}
                {l.referenceNumber && (
                  <span
                    style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontSize: 11, fontFamily: 'monospace' }}
                  >
                    {l.referenceNumber}
                  </span>
                )}
              </Link>,
              l.listingType.replace(/_/g, ' '),
              <StatusChip key="s" status={l.status} />,
              formatRand(l.price),
              <span key="e" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                {l._count.offers}o · {l._count.bids}b · {l._count.watchers}w
              </span>,
              formatDate(l.createdAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Seller transactions ───────────────────────────────── */}
      {d.sellerTransactions.length > 0 && (
        <Section
          title={`Sales (${d.sellerTransactions.length})`}
          subtitle="Transactions where this user was the seller"
        >
          <Table
            head={['Listing', 'Buyer', 'Payout', 'Status', 'Date']}
            rows={d.sellerTransactions.map((t) => [
              <Link
                key="l"
                href={`/admin/transactions/${t.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {t.listing.title}
              </Link>,
              t.buyer.username ?? '—',
              formatRand(t.sellerPayout),
              <StatusChip key="s" status={t.paymentStatus} />,
              formatDate(t.createdAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Buyer transactions ────────────────────────────────── */}
      {d.buyerTransactions.length > 0 && (
        <Section
          title={`Purchases (${d.buyerTransactions.length})`}
          subtitle="Transactions where this user was the buyer"
        >
          <Table
            head={['Listing', 'Seller', 'Total', 'Status', 'Date']}
            rows={d.buyerTransactions.map((t) => [
              <Link
                key="l"
                href={`/admin/transactions/${t.id}`}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {t.listing.title}
              </Link>,
              t.seller.username ?? '—',
              formatRand(t.buyerTotal),
              <StatusChip key="s" status={t.paymentStatus} />,
              formatDate(t.createdAt),
            ])}
          />
        </Section>
      )}

      {/* ─── Offers + bids — side by side ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {d.buyerOffers.length > 0 && (
          <Section title={`Offers made (${d.buyerOffers.length})`} subtitle="Take-a-Shot offers from this buyer">
            <Table
              head={['Listing', 'Offer', 'Status', 'Date']}
              rows={d.buyerOffers.map((o) => [
                <Link
                  key="l"
                  href={`/admin/listings/${o.listing.id}`}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                >
                  {o.listing.title}
                </Link>,
                formatRand(o.offerAmount),
                <StatusChip key="s" status={o.status} />,
                formatDate(o.createdAt),
              ])}
            />
          </Section>
        )}

        {d.bids.length > 0 && (
          <Section title={`Bids placed (${d.bids.length})`} subtitle="Auction bids from this buyer">
            <Table
              head={['Listing', 'Bid', 'Won', 'Date']}
              rows={d.bids.map((b) => [
                <Link
                  key="l"
                  href={`/admin/listings/${b.listing.id}`}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                >
                  {b.listing.title}
                </Link>,
                formatRand(b.amount),
                b.isWinner ? (
                  <span key="w" style={{ color: '#22c55e' }}>✓ Won</span>
                ) : (
                  <span key="w" style={{ color: 'var(--text-tertiary)' }}>—</span>
                ),
                formatDate(b.createdAt),
              ])}
            />
          </Section>
        )}
      </div>

      {/* ─── Ratings — received + given ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {d.ratingsReceived.length > 0 && (
          <Section
            title={`Ratings received (${d.ratingsReceived.length})`}
            subtitle="Public reviews on this user as seller"
          >
            <div className="space-y-2">
              {d.ratingsReceived.slice(0, 10).map((r) => (
                <RatingCard
                  key={r.id}
                  stars={r.stars}
                  comment={r.comment}
                  by={`@${r.rater.username ?? 'anonymous'}`}
                  date={r.createdAt}
                />
              ))}
            </div>
          </Section>
        )}
        {d.ratingsGiven.length > 0 && (
          <Section
            title={`Ratings given (${d.ratingsGiven.length})`}
            subtitle="Reviews this user has left for sellers"
          >
            <div className="space-y-2">
              {d.ratingsGiven.slice(0, 10).map((r) => (
                <RatingCard
                  key={r.id}
                  stars={r.stars}
                  comment={r.comment}
                  by={
                    <Link
                      href={`/admin/users/${r.rated.id}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      @{r.rated.username ?? 'anonymous'}
                    </Link>
                  }
                  date={r.createdAt}
                />
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* ─── Audit trail — admin actions against this user ─────── */}
      {d.auditEvents.length > 0 && (
        <Section
          title={`Admin actions on this user (${d.auditEvents.length})`}
          subtitle="Every destructive admin action recorded against this account"
        >
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

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
      {sub && (
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {sub}
        </p>
      )}
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

function RatingCard({
  stars,
  comment,
  by,
  date,
}: {
  stars: number;
  comment: string | null;
  by: React.ReactNode;
  date: string;
}) {
  return (
    <div
      className="rounded-[6px] p-3"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: '#f59e0b' }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>{formatDate(date)}</span>
      </div>
      {comment && (
        <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
          {comment}
        </p>
      )}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{by}</p>
    </div>
  );
}

// Best-effort JSON pretty for audit "Change" column — handles the
// strings the audit service stores (could be "VERIFIED" or `"VERIFIED"`).
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
