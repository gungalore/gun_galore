// Pure geo helpers for the buyer-distance feature (Phase 4 W3).
//
// The listing's exact pickup/dealer coordinates are NEVER returned to a client
// — only a coarse distance. `roundKm` snaps to a step (default 5 km) so a
// caller cannot triangulate an exact seller location by querying from two or
// three known points.

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two lat/lng points. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Snap a distance to a coarse step (default 5 km) to protect seller privacy. */
export function roundKm(km: number, step = 5): number {
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round(km / step) * step;
}
