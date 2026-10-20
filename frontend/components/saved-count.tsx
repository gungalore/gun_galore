// Compact "N saved" social-proof count for browse cards.
//
// The number is the real Wishlist (WatchedListing) count for the listing -
// never invented, never inflated. Below 1 we render nothing: a card that says
// "0 saved" is a negative signal dressed as social proof. The caller owns the
// optimistic +/-1 while the current viewer toggles their own heart.

export function SavedCount({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (!Number.isFinite(count) || count < 1) return null;
  const label = `${count} ${count === 1 ? 'person has' : 'people have'} saved this listing`;

  return (
    <span
      className={className}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="var(--red)"
        aria-hidden
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span>{count} saved</span>
    </span>
  );
}
