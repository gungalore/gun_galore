// ────────────────────────────────────────────────────────────────────
// APPROXIMATE DISTANCE, DISPLAYED THE ONE WAY IT IS ALLOWED TO BE.
//
// ⚠️ SNAPPED TO 5 KM AND NEVER A DELIVERY ESTIMATE. The backend already snaps
// the straight-line figure; rounding here defends the display against a payload
// that carries an exact metre-level number. The tooltip says both things
// because a bare "150km" next to a courier listing reads as a shipping promise
// it is not.
// ────────────────────────────────────────────────────────────────────

export const DISTANCE_TOOLTIP =
  'Approximate straight-line distance from your shared location, rounded to 5 km. Not a delivery estimate.';

/**
 * The one distance string: `150km`.
 *
 * ⚠️ NO SPACE, NO DECIMAL, NO "~". The catalogue uses this exact shape so a row
 * of cards reads as a column of figures. Returns null when there is nothing to
 * show (no location, no distance, garbage payload).
 */
export function formatDistanceKm(
  km: number | null | undefined,
): string | null {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return null;
  const snapped = Math.max(5, Math.round(km / 5) * 5);
  return `${snapped}km`;
}

/** Whether a distance is worth rendering at all. */
export function shouldShowDistance(km: number | null | undefined): boolean {
  return formatDistanceKm(km) !== null;
}
