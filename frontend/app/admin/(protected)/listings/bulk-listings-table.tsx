'use client';

// Client-side table for the PENDING_REVIEW tab. Same columns as the
// server-side listings table but with a leading checkbox column and
// a sticky bulk-actions bar at the bottom when ≥1 row is selected.
// Per-row Approve/Reject buttons still live in the existing
// <ReviewActions/> component which we render in the rightmost cell.
//
// Only shown on PENDING_REVIEW because bulk operations don't make
// sense for ACTIVE/CANCELLED/SOLD etc — for those the existing
// server-rendered table is fine.

import { useState } from 'react';
import Link from 'next/link';
import ReviewActions from './review-actions';
import DeleteListingButton from './delete-button';
import { useBulkSelect, BulkListingActionsBar } from './bulk-actions';

// Match the shape the parent page already uses for its server-side
// Listing rows. `status` is on the parent's type even though we
// receive it via the separate `status` prop. Claude fields use the
// same strict union the parent declares to avoid two-type-name
// mismatch errors at the boundary.
interface Listing {
  id: string;
  referenceNumber: string | null;
  title: string;
  price: number | null;
  status: string;
  createdAt: string;
  claudeDecision:
    | 'APPROVE'
    | 'AUTO_FIX_AND_APPROVE'
    | 'REJECT'
    | 'HUMAN_REVIEW'
    | null;
  claudeConfidence: number | null;
  claudeReasons: string[];
  category: { name: string; isFirearm: boolean };
  seller: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
  images: { url: string; isPrimary: boolean }[];
}

const DECISION_COLOR: Record<string, string> = {
  APPROVE: '#22c55e',
  AUTO_FIX_AND_APPROVE: '#22c55e',
  REJECT: 'var(--red)',
  HUMAN_REVIEW: '#f59e0b',
};

export default function BulkListingsTable({
  listings,
  status,
}: {
  listings: Listing[];
  status: string;
}) {
  const ids = listings.map((l) => l.id);
  const { selected, toggle, toggleAll, clear } = useBulkSelect(ids);
  const [allChecked, setAllChecked] = useState(false);

  function handleToggleAll() {
    toggleAll();
    setAllChecked((v) => !v);
  }

  return (
    <>
      <div
        className="rounded-[8px] overflow-hidden"
        style={{ border: '0.5px solid var(--border)' }}
      >
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-inset)' }}>
              <th
                className="px-3 py-2.5"
                style={{ width: 36, borderBottom: '0.5px solid var(--border)' }}
              >
                <input
                  type="checkbox"
                  checked={allChecked && listings.length > 0}
                  onChange={handleToggleAll}
                  aria-label="Select all listings on this page"
                  style={{ accentColor: 'var(--red)' }}
                />
              </th>
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
            {listings.map((l) => {
              const isSelected = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  style={{
                    borderBottom: '0.5px solid var(--border-divider)',
                    background: isSelected ? 'rgba(200,16,46,0.05)' : undefined,
                  }}
                >
                  <td className="px-3 py-3" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(l.id)}
                      aria-label={`Select ${l.title}`}
                      style={{ accentColor: 'var(--red)' }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/listings/${l.id}`}
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
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>
                    <Link
                      href={`/admin/listings/${l.id}`}
                      className="font-medium"
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      {l.title}
                    </Link>
                    {l.category.isFirearm && (
                      <span className="text-xs ml-2" style={{ color: 'var(--red)' }}>
                        🔒 Firearm
                      </span>
                    )}
                    {l.claudeDecision && (
                      <div className="mt-1.5">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-[3px]"
                          style={{
                            background: 'var(--bg-inset)',
                            color: DECISION_COLOR[l.claudeDecision] ?? 'var(--text-tertiary)',
                            border: `0.5px solid ${DECISION_COLOR[l.claudeDecision] ?? 'var(--border)'}40`,
                          }}
                        >
                          {l.claudeDecision === 'AUTO_FIX_AND_APPROVE'
                            ? 'AUTO-FIX'
                            : l.claudeDecision.replace('_', ' ')}
                          {l.claudeConfidence !== null && (
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {' '}({Math.round(l.claudeConfidence * 100)}%)
                            </span>
                          )}
                        </span>
                        {l.claudeReasons.length > 0 && (
                          <p
                            className="text-xs mt-1"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            {l.claudeReasons.slice(0, 2).join(' · ')}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {[l.seller.firstName, l.seller.lastName].filter(Boolean).join(' ') || l.seller.email}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {l.category.name}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                    {l.price ? `R ${(l.price / 100).toLocaleString('en-ZA')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(l.createdAt).toLocaleDateString('en-ZA')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {status === 'PENDING_REVIEW' && <ReviewActions listingId={l.id} />}
                      <DeleteListingButton listingId={l.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BulkListingActionsBar selected={selected} onClear={() => { clear(); setAllChecked(false); }} />
    </>
  );
}
