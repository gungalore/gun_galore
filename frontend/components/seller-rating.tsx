// UX-1b — seller-level rating display (stars + review count).
//
// Two variants:
//   compact  (listing cards) — a single amber star + "4.5 (12)" to keep
//            card density; sits under the seller line.
//   full     (PDP, near the title) — "★★★★☆  Seller rating 4.5 · 12 reviews",
//            optionally linked to the seller profile.
//
// This is a SELLER rating, not an item rating — the copy says "Seller rating"
// so we never imply per-item reviews exist. Renders nothing when the seller
// has no ratings yet (averageRating null / count 0). Star glyphs + amber match
// the existing seller-profile + reviews rendering.

import Link from 'next/link';

const AMBER = '#f59e0b';

export function SellerRating({
  rating,
  count,
  href,
  compact = false,
}: {
  rating?: number | null;
  count?: number | null;
  /** When set (full variant), the rating links to the seller profile. */
  href?: string;
  compact?: boolean;
}) {
  if (rating == null || !count) return null;

  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  const stars = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
  const ariaLabel = `Seller rating ${rating.toFixed(1)} out of 5, ${count} review${
    count === 1 ? '' : 's'
  }`;

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label={ariaLabel}
      >
        <span style={{ color: AMBER }} aria-hidden>
          ★
        </span>
        {rating.toFixed(1)} ({count})
      </span>
    );
  }

  const body = (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      aria-label={ariaLabel}
    >
      <span style={{ color: AMBER, letterSpacing: '0.03em' }} aria-hidden>
        {stars}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>
        Seller rating {rating.toFixed(1)} · {count} review
        {count === 1 ? '' : 's'}
      </span>
    </span>
  );

  return href ? (
    <Link href={href} style={{ textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  );
}
