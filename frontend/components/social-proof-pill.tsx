// SocialProofPill — small chip surfacing "X people saved this" on
// listing detail pages.
//
// Threshold: the caller decides. Cards and the PDP show the count from 1
// (the operator asked for the real number on every item); `minCount` exists
// for surfaces that would rather hide a cold-start "1 person" signal. A
// zero count is never rendered - "0 saved" is anti-proof.
//
// The pill is intentionally subtle — slim border, no fill, no
// shadow. It's a *signal*, not a call to action. The Wishlist button
// is the CTA.

import type { CSSProperties } from 'react';

interface Props {
  /** How many users saved/watch this listing. */
  count: number;
  /** Lowest count that renders. Defaults to 1 (zero never renders). */
  minCount?: number;
  /** Optional override style — used to place the pill inline next
   * to the price block. */
  style?: CSSProperties;
  /** Optional copy override. Defaults to "Saved by N people". The
   * number is always Wishlist (WatchedListing) saves - not auction
   * `AuctionWatch` opt-ins - so do not relabel it "watching". */
  label?: (n: number) => string;
}

const DEFAULT_LABEL = (n: number) => `Saved by ${n} ${n === 1 ? 'person' : 'people'}`;

export function SocialProofPill({
  count,
  minCount = 1,
  style,
  label = DEFAULT_LABEL,
}: Props) {
  // Threshold gate — below the caller's floor we render nothing. Returning
  // null is intentional; callers don't need to wrap in conditionals.
  if (!Number.isFinite(count) || count < Math.max(1, minCount)) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 999,
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
        ...style,
      }}
      title={label(count)}
    >
      {/* Small heart icon — repurposed from WishlistButton — gives
          the count a visual referent without spelling it out. */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {label(count)}
    </span>
  );
}
