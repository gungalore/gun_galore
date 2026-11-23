// The public "Usually replies within ..." badge on a listing.
//
// Computed from the seller's ACTUAL first replies over the last 90 days, never
// from a promise or a self-reported setting. One sample is one inquiry where
// the seller replied at least once: minutes = sellerFirstReplyAt - createdAt,
// and createdAt is the first buyer message because the thread is created by it.
//
// ⚠️ SMALL SAMPLES SAY SO. Three replies is the floor; below it the badge says
// "reply time not yet known" rather than letting one fast reply read as a
// service level. The badge is a guide, not an SLA, and the copy says "usually".
export const MIN_REPLY_SAMPLES = 3;
export const REPLY_WINDOW_DAYS = 90;
export const REPLY_SAMPLE_CAP = 50;

export interface SellerReplyLabel {
  label: string;
  sampleSize: number;
}

const NEW_SELLER_LABEL = 'New seller — reply time not yet known';

/** Median of the finite, non-negative samples, or null when there are none. */
export function medianMinutes(samples: readonly number[]): number | null {
  const clean = samples.filter((n) => Number.isFinite(n) && n >= 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turn reply-time samples (minutes) into the public label.
 *
 * Buckets are deliberately coarse: "within a day" survives a slow weekend,
 * whereas "within 16 hours" invites a complaint about a 16.1-hour reply.
 */
export function replyLabelFor(samples: readonly number[]): SellerReplyLabel {
  const clean = samples.filter((n) => Number.isFinite(n) && n >= 0);
  const sampleSize = clean.length;
  if (sampleSize < MIN_REPLY_SAMPLES) {
    return { label: NEW_SELLER_LABEL, sampleSize };
  }

  const median = medianMinutes(clean);
  if (median === null) return { label: NEW_SELLER_LABEL, sampleSize };

  let label: string;
  if (median <= 60) label = 'Usually replies within an hour';
  else if (median <= 240) label = 'Usually replies within a few hours';
  else if (median <= 1_440) label = 'Usually replies within a day';
  else if (median <= 2_880) label = 'Usually replies within 2 days';
  else if (median <= 10_080) label = 'Usually replies within a week';
  else label = 'Replies can take longer than a week';

  return { label, sampleSize };
}
