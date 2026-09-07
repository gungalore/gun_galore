// ────────────────────────────────────────────────────────────────────
// WHERE THINGS ARE, AND HOW FAR APART.
//
// ⚠️ THE GEOCODER'S RULES ARE COPIED FROM crime-stats.service.ts AND MUST
// STAY IDENTICAL: region=za, components=country:ZA, an 8-second timeout, and
// the address is NEVER logged. Without the country filter "Brooklyn"
// geocodes to New York and "Kimberley" to Western Australia — which for this
// feature would print an Australian robbery in a Northern Cape motivation.
//
// The address rule is the reason this is not shared code with crime-stats:
// that service geocodes a MEMBER'S HOME ADDRESS and this one geocodes a place
// name off a newspaper. Two different sensitivities, one identical policy,
// and the policy is what has to be copied — not the caller.
// ────────────────────────────────────────────────────────────────────

/** Both Google calls in crime-stats use this. A member may be waiting. */
export const GEOCODE_TIMEOUT_MS = 8_000;

const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A degrees box that CONTAINS the circle, for the SQL pre-filter.
 *
 * ⚠️ ALWAYS WIDER THAN THE CIRCLE, NEVER NARROWER. Postgres cannot index a
 * haversine, so the box is what the (lat, lng) index serves and the exact
 * distance is computed in the service over what comes back. A box that clipped
 * the circle would silently drop the furthest true matches, so the longitude
 * span is divided by cos(lat) and clamped — at South Africa's latitudes that
 * is a ~15% overshoot, which is a few extra rows read and nothing else.
 */
export function boundingBox(
  lat: number,
  lng: number,
  km: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = km / 111.32;
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const dLng = km / (111.32 * cos);
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}

/**
 * Google Geocoding, South Africa only.
 *
 * ⚠️ NEVER LOGS THE QUERY and never throws — a geocode we cannot do is a
 * missing coordinate, which the caller already handles by falling back to the
 * source's own centre. Returns null with no key set, which is the ordinary
 * state of a developer's machine.
 */
export async function geocodeZa(
  query: string,
  signal?: AbortSignal,
): Promise<LatLng | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !query.trim()) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query.trim());
    // South Africa only. Without it "Brooklyn" geocodes to New York.
    url.searchParams.set('region', 'za');
    url.searchParams.set('components', 'country:ZA');
    url.searchParams.set('key', key);

    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const loc = body.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      return null;
    }
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

/**
 * SAPS writes "Ehlanzeni District" where a municipality's own site writes
 * "Ehlanzeni", and "City of Tshwane" appears with and without the "City of".
 *
 * ⚠️ THIS IS THE FALLBACK MATCH FOR AN ARTICLE WITH NO COORDINATES, so it is
 * deliberately lenient — the cost of a loose match is a clipping from the
 * next town over, which a member can see and discard; the cost of a strict
 * one is a rural precinct with no clippings at all.
 */
export function districtMatches(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) =>
    (s ?? '')
      .toLowerCase()
      .replace(/\b(district|metropolitan|metro|municipality|city of)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const x = norm(a);
  const y = norm(b);
  return x.length > 2 && y.length > 2 && (x === y || x.includes(y) || y.includes(x));
}
