/**
 * HOW A MEMBER READS THEIR OWN COMPLAINT CASE — labels, tone and the one line
 * of history the API can actually support.
 *
 * Complaint.status is a free-form String in the database (the comments in
 * schema.prisma enumerate OPEN | UNDER_REVIEW | AWAITING_USER | RESOLVED |
 * CLOSED), so a raw `status` printed into the page would one day show
 * `UNDER_REVIEW` to a member, or blank out for a status added after this file
 * was written. The label map lives here — outside the server component — so
 * lib/complaint-status.spec.ts can hold the fallback.
 *
 * The "history" the page can show is the list of cases themselves plus the two
 * timestamps the API returns (createdAt, resolvedAt). There is no status-event
 * table behind Complaint and pretending otherwise would be invention.
 */

export interface ComplaintStatusTone {
  label: string;
  /** Text/accent token from globals.css. */
  color: string;
  /** Wash token from globals.css. */
  background: string;
}

const TONES: Record<string, ComplaintStatusTone> = {
  OPEN: {
    label: 'Open',
    color: 'var(--warning)',
    background: 'var(--warning-wash)',
  },
  UNDER_REVIEW: {
    label: 'Under review',
    color: 'var(--info)',
    background: 'var(--bg-inset)',
  },
  AWAITING_USER: {
    // Deliberately second-person: the case is blocked on the MEMBER, and a
    // status that says "awaiting user" to a member is a status they cannot act
    // on. The admin register keeps the terse wording; this page is theirs.
    label: 'Waiting on you',
    color: 'var(--warning)',
    background: 'var(--warning-wash)',
  },
  RESOLVED: {
    label: 'Resolved',
    color: 'var(--success)',
    background: 'var(--success-wash)',
  },
  CLOSED: {
    label: 'Closed',
    color: 'var(--text-tertiary)',
    background: 'var(--bg-inset)',
  },
};

/** Label + tone for a case status, with a readable fallback for new values. */
export function complaintStatusTone(status: string): ComplaintStatusTone {
  const key = (status ?? '').trim().toUpperCase();
  const known = TONES[key];
  if (known) return known;
  return {
    label: key ? key.replace(/_/g, ' ').toLowerCase() : 'Unknown',
    color: 'var(--text-tertiary)',
    background: 'var(--bg-inset)',
  };
}

/** Human wording for the category values the complaint form writes. */
const CATEGORY_LABELS: Record<string, string> = {
  NOT_ARRIVED: 'Item never arrived',
  ITEM_NOT_AS_DESCRIBED: 'Item not as described',
  DAMAGED: 'Item arrived damaged',
  DELIVERY: 'Delivery or courier',
  PAYOUT: 'Payout or payment',
  ACCOUNT: 'Account or privacy',
  LISTING: 'A listing or another member',
  LOCATION_OR_ACCESS: 'Could not reach the item',
  OTHER: 'Something else',
};

export function complaintCategoryLabel(category: string): string {
  const key = (category ?? '').trim().toUpperCase();
  return CATEGORY_LABELS[key] ?? (key ? key.replace(/_/g, ' ').toLowerCase() : 'Complaint');
}

/**
 * The one-line case history the page can stand behind.
 *
 * A resolved case reports when it was resolved; an open one reports when it
 * was logged. No claim is made about acknowledgement SLAs here — the page's
 * copy points at /complaints for the timeframes, and inventing a second
 * promise in a label is how the two drift.
 */
export function complaintHistoryLine(
  complaint: { createdAt: string; resolvedAt?: string | null },
  formatDate: (value: string) => string,
): string {
  const logged = formatDate(complaint.createdAt);
  if (complaint.resolvedAt) {
    return `Logged ${logged} · Resolved ${formatDate(complaint.resolvedAt)}`;
  }
  return `Logged ${logged}`;
}
