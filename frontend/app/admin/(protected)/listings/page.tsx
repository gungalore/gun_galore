'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import BulkListingsTable from './bulk-listings-table';
import ReviewActions from './review-actions';
import DeleteListingButton from './delete-button';

interface Listing {
  id: string;
  // Human-trackable ref shown to admins + sellers (e.g. UM000123).
  // Nullable for legacy rows created before the schema added it — the
  // backfill script should have populated everything, but the UI
  // tolerates null defensively.
  referenceNumber: string | null;
  title: string;
  price: number | null;
  status: string;
  createdAt: string;
  seller: { firstName: string | null; lastName: string | null; email: string };
  category: { name: string; isFirearm: boolean };
  // Claude moderation fields
  claudeDecision:
    | 'APPROVE'
    | 'AUTO_FIX_AND_APPROVE'
    | 'REJECT'
    | 'HUMAN_REVIEW'
    | null;
  claudeConfidence: number | null;
  claudeReasons: string[];
  claudeAutoFixApplied: boolean;
  claudeOriginalDescription: string | null;
  // Backend returns the primary image with each listing row (the
  // /admin/listings endpoint takes `images: { where: { isPrimary: true }, take: 1 }`).
  // Declared here so BulkListingsTable's structural type matches.
  images: { url: string; isPrimary: boolean }[];
}

const DECISION_COLOR: Record<string, string> = {
  APPROVE: '#22c55e',
  AUTO_FIX_AND_APPROVE: '#3b82f6',
  REJECT: '#ef4444',
  HUMAN_REVIEW: '#f59e0b',
};

const DECISION_LABEL: Record<string, string> = {
  APPROVE: 'Auto-approved',
  AUTO_FIX_AND_APPROVE: 'Auto-fixed (contact info stripped)',
  REJECT: 'Auto-rejected',
  HUMAN_REVIEW: 'Sent to human review',
};

interface ListingsResponse {
  listings: Listing[];
  total: number;
  page: number;
  limit: number;
}

export default function AdminListingsPage() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? 'PENDING_REVIEW';
  const page = searchParams.get('page') ?? '1';

  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      const res = await adminFetch(
        `/admin/listings?status=${status}&page=${page}&limit=20`,
      );
      if (cancelled) return;
      if (res.ok) setData(await res.json());
      else setData(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  // All terminal statuses an admin might need to audit. Was previously
  // only the 3 "live workflow" statuses — meant historic SOLD, EXPIRED,
  // DRAFT listings were unreachable from the index.
  const tabs = [
    'PENDING_REVIEW',
    'ACTIVE',
    'SOLD',
    'CANCELLED',
    'EXPIRED',
    'DRAFT',
  ];

  return (
    <div>
      <h1 className="text-lg font-medium mb-5" style={{ color: 'var(--text-primary)' }}>
        Listings
      </h1>

      {/* Tabs — swapped raw <a> for next/link so tab switching is
          client-side navigation, not a full page reload. */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/admin/listings?status=${t}`}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={{
              background: status === t ? 'var(--red)' : 'var(--bg-card)',
              color: status === t ? '#fff' : 'var(--text-secondary)',
              border: `0.5px solid ${status === t ? 'transparent' : 'var(--border)'}`,
              textDecoration: 'none',
            }}
          >
            {t.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>

      {!loaded ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
      ) : !data ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load listings.</p>
      ) : data.listings.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No listings in this queue.</p>
      ) : status === 'PENDING_REVIEW' ? (
        /* PENDING_REVIEW tab uses the bulk-enabled client table —
           lets the admin select multiple listings and approve or
           reject in one call. Other tabs don't need bulk because
           the per-row actions there (delete, view) are individual
           decisions anyway. */
        <BulkListingsTable listings={data.listings} status={status} />
      ) : (
        <>
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ border: '0.5px solid var(--border)' }}
          >
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-inset)' }}>
                  {['Ref', 'Title', 'Seller', 'Category', 'Price', 'Submitted', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2.5 text-xs font-medium"
                      style={{ color: 'var(--text-tertiary)', borderBottom: '0.5px solid var(--border)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.listings.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '0.5px solid var(--border-divider)' }}>
                    {/* Reference number — prefix encodes type (UM/AU/TS).
                        Shown in a monospace pill so it's scannable in the
                        admin queue. Falls back to a short cuid for legacy
                        rows that haven't been back-filled. */}
                    <td className="px-4 py-3">
                      <a
                        href={`/listings/${l.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          background: 'var(--bg-inset)',
                          border: '0.5px solid var(--border)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          textDecoration: 'none',
                        }}
                      >
                        {l.referenceNumber ?? l.id.slice(-8)}
                      </a>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                      <a
                        href={`/listings/${l.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium"
                        style={{
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                        }}
                      >
                        {l.title}
                      </a>
                      {l.category.isFirearm && (
                        <span
                          className="text-xs ml-2"
                          style={{ color: 'var(--red)' }}
                        >
                          🔒 Firearm
                        </span>
                      )}
                      {/* Claude decision pill */}
                      {l.claudeDecision && (
                        <div className="mt-1.5">
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-[3px]"
                            style={{
                              background: 'var(--bg-inset)',
                              color: DECISION_COLOR[l.claudeDecision],
                              border: `0.5px solid ${DECISION_COLOR[l.claudeDecision]}40`,
                            }}
                            title={DECISION_LABEL[l.claudeDecision]}
                          >
                            {l.claudeDecision === 'AUTO_FIX_AND_APPROVE' ? 'AUTO-FIX' : l.claudeDecision.replace('_', ' ')}
                            {l.claudeConfidence !== null && (
                              <span style={{ color: 'var(--text-tertiary)' }}>
                                {' '}({Math.round(l.claudeConfidence * 100)}%)
                              </span>
                            )}
                          </span>
                          {l.claudeReasons.length > 0 && (
                            <ul
                              className="mt-1.5 text-xs leading-snug"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              {l.claudeReasons.slice(0, 3).map((r, i) => (
                                <li key={i}>• {r}</li>
                              ))}
                            </ul>
                          )}
                          {l.claudeAutoFixApplied && (
                            <p
                              className="mt-1 text-xs"
                              style={{ color: '#3b82f6' }}
                              title={
                                l.claudeOriginalDescription
                                  ? 'Original description: ' + l.claudeOriginalDescription.slice(0, 200)
                                  : ''
                              }
                            >
                              ✎ Contact info stripped
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      <div>{[l.seller.firstName, l.seller.lastName].filter(Boolean).join(' ') || '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{l.seller.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {l.category.name}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-primary)' }}>
                      {l.price !== null
                        ? `R${(l.price / 100).toLocaleString('en-ZA', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3">
                      {/* "View" always available so admins can open the
                          public listing detail page in a new tab — handy
                          for ACTIVE / CANCELLED queues where the
                          Approve/Reject actions aren't shown. */}
                      <div className="flex flex-col gap-2 items-start">
                        <a
                          href={`/listings/${l.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs"
                          style={{
                            color: 'var(--text-secondary)',
                            textDecoration: 'none',
                            border: '0.5px solid var(--border)',
                            borderRadius: 4,
                            padding: '4px 10px',
                          }}
                        >
                          View →
                        </a>
                        {status === 'PENDING_REVIEW' && (
                          <ReviewActions listingId={l.id} />
                        )}
                        {/* Delete is available on EVERY non-CANCELLED
                            listing — soft-deletes via admin reason
                            and notifies the seller by email. The
                            CANCELLED tab is the post-delete state,
                            so no button there. */}
                        {l.status !== 'CANCELLED' && (
                          <DeleteListingButton listingId={l.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>{data.total} total</span>
            <div className="flex gap-2">
              {Number(page) > 1 && (
                <a
                  href={`/admin/listings?status=${status}&page=${Number(page) - 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  ← Prev
                </a>
              )}
              {Number(page) * data.limit < data.total && (
                <a
                  href={`/admin/listings?status=${status}&page=${Number(page) + 1}`}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  Next →
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
