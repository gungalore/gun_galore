'use client';

import { useDistanceKm } from '@/lib/distance-context';
import { DISTANCE_TOOLTIP, formatDistanceKm } from '@/lib/distance-format';

// ────────────────────────────────────────────────────────────────────
// "150km ⓘ" — THE WHOLE DISTANCE AFFORDANCE.
//
// ⚠️ HIDES ITSELF. No provider, no location, no distance (or a failed batch)
// means no badge at all; a catalogue must never carry an empty placeholder.
//
// ⚠️ THE TOOLTIP IS THE HONESTY. Straight-line, from their shared location,
// snapped to 5 km, and explicitly NOT a delivery estimate — otherwise a buyer
// reads it as a courier promise and /checkout disagrees.
// ────────────────────────────────────────────────────────────────────

export default function ItemDistance({
  listingId,
  className,
}: {
  listingId: string;
  className?: string;
}) {
  const km = useDistanceKm(listingId);
  const label = formatDistanceKm(km);
  if (!label) return null;
  return (
    <span
      className={className}
      title={DISTANCE_TOOLTIP}
      aria-label={`${label} from your shared location. ${DISTANCE_TOOLTIP}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        color: 'var(--text-tertiary)',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>
        ⓘ
      </span>
    </span>
  );
}
