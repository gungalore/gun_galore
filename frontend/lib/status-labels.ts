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

// Card-refund turnaround, as published on /refund-policy ("typically 3–7
// business days"). Two order surfaces used to quote different numbers
// (5–10 business days on the seller-rejected block, 3–7 working days on the
// buyer-cancel panel) for the exact same rail — a buyer who saw both learnt
// to trust neither. Every buyer-facing refund promise now interpolates this
// one string; the refund-policy page stays the source of truth it matches.
export const REFUND_ETA_COPY = '3–7 business days';

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
    // Generic (method-agnostic) wording. The old copy promised "once the
    // buyer confirms delivery", which is simply untrue on a firearm
    // DEALER_TRANSFER (no confirm button exists — release happens on
    // dealer stock-in verification) and slightly off for in-person
    // collection. Render sites that know the shipping method should call
    // paymentStatusHint() below for the precise sentence; this stays as
    // the honest fallback for surfaces that don't.
    label: 'Payment held',
    tone: 'pending',
    hint: "Funds are held securely by All Outdoor while the sale completes. They're released to the seller once the hand-over is confirmed — usually within a few days.",
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

/** Payment-status hint that knows how the item actually changes hands.
 *
 * Only HELD differs by shipping method — that's the status whose static
 * hint told a firearm buyer to wait for a "confirm delivery" button that
 * never renders for them (DEALER_TRANSFER releases on dealer stock-in
 * verification), and told a collection buyer about "delivery" when they're
 * driving out to fetch the item. Every other status reads the same on all
 * paths, so we fall through to the static table entry.
 *
 * Wording stays third-person ("the buyer") because the same pill is shown
 * on both /my/orders and /my/sales. */
export function paymentStatusHint(
  code: string | null | undefined,
  shippingMethod?: string | null,
): string | undefined {
  if (code === 'HELD') {
    if (shippingMethod === 'DEALER_TRANSFER') {
      return "Funds are held securely by All Outdoor. A firearm has no delivery confirmation step — payment is released once we've verified the firearm is booked into the receiving dealer's stock.";
    }
    if (shippingMethod === 'COLLECTION') {
      return 'Funds are held securely by All Outdoor until the buyer confirms they have collected the item in person.';
    }
    if (shippingMethod === 'ON_SITE_SERVICE') {
      return 'Funds are held securely by All Outdoor until the buyer confirms the booking went ahead.';
    }
  }
  return resolveStatus(PAYMENT_STATUS, code).hint;
}

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
