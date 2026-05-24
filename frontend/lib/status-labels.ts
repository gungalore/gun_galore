// Human-friendly copy for the internal status codes that leak into
// user-facing pills. Cross-cutting audit flagged that the live UI
// shows raw enum values like "HELD" or "PENDING_ADMIN_VERIFICATION"
// — terms only the dev team understands. This module centralises the
// translation so every page renders the same friendly label.
//
// Each entry has:
//   - label: the short string to show in the pill (≤ 24 chars so the
//     pill doesn't wrap on mobile)
//   - tone:  semantic colour bucket (success / pending / error /
//     info / neutral) so cards can colour the pill without each
//     page maintaining its own STATUS_COLOR table
//   - hint:  optional one-sentence explanation we surface as a
//     tooltip or inline help — keeps the friendly label short while
//     still giving the curious user the "why" they need to trust the
//     status
//
// New status codes should be added here first; pages should not
// invent their own copy.

export type StatusTone = 'success' | 'pending' | 'error' | 'info' | 'neutral';

export interface StatusEntry {
  label: string;
  tone: StatusTone;
  hint?: string;
}

const TONE_COLOR: Record<StatusTone, string> = {
  success: '#00a03c',
  pending: '#d49a3a',
  error: 'var(--red)',
  info: '#6366f1',
  neutral: 'var(--text-tertiary)',
};

// PaymentStatus on the Transaction model.
export const PAYMENT_STATUS: Record<string, StatusEntry> = {
  HELD: {
    label: 'Payment held',
    tone: 'pending',
    hint: "Funds are securely held while we verify the sale. They'll clear to the seller once the buyer confirms delivery — usually within a few days.",
  },
  PENDING_ADMIN_VERIFICATION: {
    label: 'Verifying',
    tone: 'info',
    hint: 'Our team is reviewing this transaction. It moves to Payment held once verification completes.',
  },
  RELEASED: {
    label: 'Payout released',
    tone: 'success',
    hint: 'Funds were released to the seller.',
  },
  DISPUTED: {
    label: 'Disputed',
    tone: 'error',
    hint: 'A dispute was raised. Our team is investigating before any funds move.',
  },
  REFUNDED: {
    label: 'Refunded',
    tone: 'neutral',
    hint: 'The buyer was refunded in full.',
  },
};

// ListingStatus on the Listing model.
export const LISTING_STATUS: Record<string, StatusEntry> = {
  ACTIVE: { label: 'Live', tone: 'success' },
  PENDING_REVIEW: {
    label: 'Awaiting review',
    tone: 'pending',
    hint: "Our team is reviewing this listing. It'll go live within a few hours.",
  },
  DRAFT: { label: 'Draft', tone: 'neutral', hint: 'Not yet published.' },
  REJECTED: {
    label: 'Rejected',
    tone: 'error',
    hint: 'This listing was rejected. Open it to see why and resubmit.',
  },
  SOLD: { label: 'Sold', tone: 'info' },
  PAYMENT_PENDING: {
    label: 'Awaiting payment',
    tone: 'pending',
    hint: 'A buyer is in the payment flow — listing is reserved until they pay or the 24h window expires.',
  },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  REMOVED: {
    label: 'Removed',
    tone: 'error',
    hint: 'Removed by an administrator.',
  },
  AUCTION_ENDED_NO_RESERVE: {
    label: 'Reserve not met',
    tone: 'neutral',
    hint: "The auction ended without reaching your reserve price — relist when you're ready.",
  },
  AUCTION_ENDED_NO_BIDS: {
    label: 'No bids',
    tone: 'neutral',
    hint: 'The auction ended with no bids placed.',
  },
};

// ShippingStatus on the Transaction model.
export const SHIPPING_STATUS: Record<string, StatusEntry> = {
  PENDING: { label: 'Awaiting dispatch', tone: 'pending' },
  COLLECTED: { label: 'Collected', tone: 'info' },
  IN_TRANSIT: { label: 'In transit', tone: 'info' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  DELIVERY_FAILED: {
    label: 'Delivery failed',
    tone: 'error',
    hint: 'The courier could not complete delivery. Contact support if no re-attempt is scheduled.',
  },
  RETURNED: { label: 'Returned to sender', tone: 'neutral' },
};

// OfferStatus on the Offer model.
export const OFFER_STATUS: Record<string, StatusEntry> = {
  PENDING: { label: 'Awaiting seller', tone: 'pending' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  COUNTERED: { label: 'Countered', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};

// KycStatus on the User model.
export const KYC_STATUS: Record<string, StatusEntry> = {
  UNVERIFIED: { label: 'Not verified', tone: 'neutral' },
  PENDING_REVIEW: { label: 'Under review', tone: 'pending' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: {
    label: 'Verification failed',
    tone: 'error',
    hint: 'Verification was unsuccessful. Open profile for details and to retry.',
  },
};

/** Resolve a status code against the given table; returns a neutral fallback
 * (with the raw code title-cased) if not present so we never render an empty
 * pill. */
export function resolveStatus(
  table: Record<string, StatusEntry>,
  code: string | null | undefined,
): StatusEntry {
  if (!code) return { label: '—', tone: 'neutral' };
  return (
    table[code] ?? {
      label: code
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      tone: 'neutral',
    }
  );
}

/** Resolve a tone to the CSS colour string we paint the pill text + halo
 * with. Background uses the same colour at 18% opacity (matches existing
 * inline patterns in /my/orders + /my/sales). */
export function toneColor(tone: StatusTone): string {
  return TONE_COLOR[tone];
}
