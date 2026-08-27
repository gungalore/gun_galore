import React from 'react';

// Unified status → colour map for admin status pills. This is the union of
// the STATUS_COLOR maps that were previously redefined on every detail page
// (listings, users, transactions, …), preserving each status's existing
// colour exactly — so adoption changes consistency, not appearance.
export const ADMIN_STATUS_COLOR: Record<string, string> = {
  // Listings
  ACTIVE: '#22c55e',
  PENDING_REVIEW: '#f59e0b',
  SOLD: '#3b82f6',
  CANCELLED: 'var(--text-secondary)',
  EXPIRED: 'var(--text-secondary)',
  DRAFT: 'var(--text-secondary)',
  PAYMENT_PENDING: '#f59e0b',
  // Claude moderation decisions
  APPROVE: '#22c55e',
  AUTO_FIX_AND_APPROVE: '#22c55e',
  REJECT: 'var(--red)',
  HUMAN_REVIEW: '#f59e0b',
  REJECTED_BY_MODERATION: 'var(--red)',
  // Offers
  PENDING: '#f59e0b',
  ACCEPTED: '#22c55e',
  REJECTED: 'var(--text-secondary)',
  COUNTERED: '#3b82f6',
  WITHDRAWN: 'var(--text-secondary)',
  EXPIRED_OFFER: 'var(--text-secondary)',
  // Q&A
  ANSWERED_BY_SELLER: '#22c55e',
  AUTO_ANSWERED: '#3b82f6',
  AWAITING_SELLER_ANSWER: '#f59e0b',
  // KYC / users
  VERIFIED: '#22c55e',
  // Transactions / funds held
  HELD: '#f59e0b',
  PENDING_ADMIN_VERIFICATION: '#f59e0b',
  RELEASED: '#22c55e',
  REFUNDED: '#6366f1',
  DISPUTED: 'var(--red)',
  // Fulfilment
  PENDING_DISPATCH: '#f59e0b',
  DISPATCHED: '#3b82f6',
  IN_TRANSIT: '#3b82f6',
  DELIVERED: '#22c55e',
  COLLECTED: '#22c55e',
  FAILED_DELIVERY: 'var(--red)',
  // Daily Deals (DD-1) — DRAFT / CANCELLED reuse the listing colours above.
  SCHEDULED: '#6366f1',
  LIVE: '#22c55e',
  EXTENDED: '#f59e0b',
  ENDED: 'var(--text-secondary)',
  SOLD_OUT: '#3b82f6',
};

/**
 * One status pill, used everywhere admin shows a status. Looks up the colour
 * from ADMIN_STATUS_COLOR (override with `color`), underscores → spaces.
 */
export function AdminStatusChip({
  status,
  color,
}: {
  status: string;
  color?: string;
}) {
  // One colour drives BOTH the ink and a 9% tint of itself as the fill, so the
  // chip is only legible if that colour clears 4.5:1 against its own tint.
  // That is why the neutral statuses above are --text-secondary (8.3:1) and
  // not --text-tertiary: tertiary is documented at exactly 4.5:1 on white, so
  // putting any tint behind it drops the label under AA (4.24:1).
  //
  // The background used to append a two-digit hex alpha directly onto `c`,
  // which silently rendered TRANSPARENT for every var()-valued status in the
  // map above - concatenating an alpha suffix onto a custom property does not
  // work, because substitution is token-based. See --red-wash in globals.css.
  const c = color ?? ADMIN_STATUS_COLOR[status] ?? 'var(--text-secondary)';
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full inline-block"
      style={{ color: c, background: `color-mix(in srgb, ${c} 9%, transparent)` }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
