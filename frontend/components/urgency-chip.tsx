// UX-1a — "Only N left" low-stock urgency chip.
//
// Rendered ONLY for inventory-tracked listings at ≤5 sellable units. The
// CALLER owns the threshold guard so the chip can never fake scarcity on a
// listing that isn't genuinely low (fake urgency = CPA s41 risk). Styling
// mirrors the auction "urgent" time chip (red tint + red border) so the two
// scarcity signals read consistently across the grid.

export function UrgencyChip({
  left,
  className,
}: {
  left: number;
  className?: string;
}) {
  return (
    <span
      className={
        className ?? 'text-xs px-1.5 py-0.5 rounded-[3px] leading-none'
      }
      style={{
        background: 'rgba(200,16,46,0.10)',
        color: 'var(--red)',
        fontWeight: 500,
        border: '0.5px solid var(--red)',
        whiteSpace: 'nowrap',
      }}
    >
      Only {left} left
    </span>
  );
}
