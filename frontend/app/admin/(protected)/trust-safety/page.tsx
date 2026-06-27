'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminSection as Section } from '@/components/admin/section';

interface Rejection {
  id: string;
  channel: string;
  category: string;
  sampleText: string;
  createdAt: string;
  user: { id: string; username: string | null; email: string } | null;
}

interface RepeatOffender {
  userId: string;
  username: string | null;
  email: string;
  rejectionCount: number;
  lastRejectionAt: string;
}

interface ReportedQuestion {
  id: string;
  question: string;
  reportedCount: number;
  status: string;
  createdAt: string;
  listing: { id: string; title: string };
  asker: { username: string | null };
}

interface ReportedListing {
  id: string;
  reason: string;
  createdAt: string;
  listing: { id: string; title: string } | null;
}

interface ReportedSeller {
  id: string;
  reason: string;
  createdAt: string;
  seller: { id: string; username: string | null; email: string } | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const CATEGORY_COLOR: Record<string, string> = {
  phone: 'var(--red)',
  email: '#f59e0b',
  url: '#3b82f6',
  'social-platform': '#a855f7',
  'off-platform-coordination': 'var(--red)',
  address: '#f59e0b',
};

export default function TrustSafetyPage() {
  const [rejections, setRejections] = useState<Rejection[] | null>(null);
  const [repeats, setRepeats] = useState<RepeatOffender[] | null>(null);
  const [reports, setReports] = useState<ReportedQuestion[] | null>(null);
  const [repListings, setRepListings] = useState<ReportedListing[] | null>(null);
  const [repSellers, setRepSellers] = useState<ReportedSeller[] | null>(null);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const [rRes, oRes, qRes, lRes, sRes] = await Promise.all([
        adminFetch('/admin/trust-safety/rejections'),
        adminFetch('/admin/trust-safety/repeat-offenders'),
        adminFetch('/admin/trust-safety/reported-questions'),
        adminFetch('/admin/trust-safety/reported-listings'),
        adminFetch('/admin/trust-safety/reported-sellers'),
      ]);
      if (cancelled) return;
      if (rRes.ok) setRejections(await rRes.json());
      if (oRes.ok) setRepeats(await oRes.json());
      if (qRes.ok) setReports(await qRes.json());
      if (lRes.ok) setRepListings(await lRes.json());
      if (sRes.ok) setRepSellers(await sRes.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-5">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Trust &amp; Safety
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Last 7 days · contact-detail blocks + reported content
        </p>
      </div>

      {/* ─── Repeat offenders — ban candidates ─────────────────── */}
      <Section
        title={`Repeat offenders (${repeats?.length ?? 0})`}
        subtitle="Users with 3+ contact-detail rejections in the last 7 days. Strong ban signal."
      >
        {!repeats || repeats.length === 0 ? (
          <Empty message="No repeat offenders in the last 7 days." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--red)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>User</Th>
                  <Th align="right">Rejections (7d)</Th>
                  <Th>Last hit</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {repeats.map((r, i) => (
                  <tr
                    key={r.userId}
                    style={
                      i < repeats.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      >
                        @{r.username ?? '(no username)'}
                      </Link>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {r.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--red)18', color: 'var(--red)', fontWeight: 500 }}
                      >
                        {r.rejectionCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatDateTime(r.lastRejectionAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${r.userId}`}
                        className="text-xs"
                        style={{ color: 'var(--red)', textDecoration: 'underline' }}
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Reported listings ────────────────────────────────── */}
      <Section
        title={`Reported listings (${repListings?.length ?? 0})`}
        subtitle="Listings flagged by a user. Review and resolve / remove as needed."
      >
        {!repListings || repListings.length === 0 ? (
          <Empty message="No reported listings right now." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>Listing</Th>
                  <Th>Reason</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {repListings.map((r, i) => (
                  <tr
                    key={r.id}
                    style={
                      i < repListings.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3 text-xs">
                      {r.listing ? (
                        <Link
                          href={`/admin/listings/${r.listing.id}`}
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          {r.listing.title}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>(deleted)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 380 }}>
                      {r.reason}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Reported sellers ─────────────────────────────────── */}
      <Section
        title={`Reported sellers (${repSellers?.length ?? 0})`}
        subtitle="Sellers flagged by a user. Review the dossier; ban if warranted."
      >
        {!repSellers || repSellers.length === 0 ? (
          <Empty message="No reported sellers right now." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>Seller</Th>
                  <Th>Reason</Th>
                  <Th>When</Th>
                  <Th align="right" />
                </tr>
              </thead>
              <tbody>
                {repSellers.map((r, i) => (
                  <tr
                    key={r.id}
                    style={
                      i < repSellers.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3 text-xs">
                      {r.seller ? (
                        <Link
                          href={`/admin/users/${r.seller.id}`}
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          @{r.seller.username ?? 'anon'}
                          <span className="block" style={{ color: 'var(--text-tertiary)' }}>
                            {r.seller.email}
                          </span>
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>(deleted)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 320 }}>
                      {r.reason}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.seller && (
                        <Link
                          href={`/admin/users/${r.seller.id}`}
                          className="text-xs"
                          style={{ color: 'var(--red)', textDecoration: 'underline' }}
                        >
                          Review →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Reported Q&A ─────────────────────────────────────── */}
      <Section
        title={`Reported Q&A (${reports?.length ?? 0})`}
        subtitle="Questions / answers flagged by a buyer or seller."
      >
        {!reports || reports.length === 0 ? (
          <Empty message="No reported Q&A right now." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>Question</Th>
                  <Th>Listing</Th>
                  <Th>Asker</Th>
                  <Th align="right">Reports</Th>
                </tr>
              </thead>
              <tbody>
                {reports.map((q, i) => (
                  <tr
                    key={q.id}
                    style={
                      i < reports.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3" style={{ maxWidth: 380 }}>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {q.question}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {q.status.replace(/_/g, ' ')} · {formatDate(q.createdAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <Link
                        href={`/admin/listings/${q.listing.id}`}
                        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      >
                        {q.listing.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      @{q.asker.username ?? 'anon'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--red)18', color: 'var(--red)' }}
                      >
                        {q.reportedCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─── Recent rejections — raw feed ─────────────────────── */}
      <Section
        title={`Contact-detail rejections (${rejections?.length ?? 0})`}
        subtitle="Every block from the contact-detail filter in the last 7 days, newest first."
      >
        {!rejections || rejections.length === 0 ? (
          <Empty message="No contact-detail rejections in the last 7 days — the filter has been quiet." />
        ) : (
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Channel</Th>
                  <Th>Category</Th>
                  <Th>Sample (capped 200 chars)</Th>
                </tr>
              </thead>
              <tbody>
                {rejections.map((r, i) => (
                  <tr
                    key={r.id}
                    style={
                      i < rejections.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.user ? (
                        <Link
                          href={`/admin/users/${r.user.id}`}
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          @{r.user.username ?? 'anon'}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          (anonymous)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.channel}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: `${CATEGORY_COLOR[r.category] ?? 'var(--text-tertiary)'}18`,
                          color: CATEGORY_COLOR[r.category] ?? 'var(--text-tertiary)',
                        }}
                      >
                        {r.category.replace(/-/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
                      <code
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          wordBreak: 'break-word',
                          display: 'block',
                        }}
                      >
                        {r.sampleText}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className="text-xs uppercase px-4 py-2"
      style={{
        color: 'var(--text-tertiary)',
        fontWeight: 500,
        textAlign: align,
      }}
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
