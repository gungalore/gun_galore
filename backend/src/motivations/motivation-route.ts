import { haversineKm, type LatLng } from '../news/news-geo';

// ────────────────────────────────────────────────────────────────────
// WHICH OF THESE AREAS DOES THE APPLICANT ACTUALLY DRIVE THROUGH?
//
// Operator, 2026-09-08: "we could also use the work address and google maps
// routes to see through which areas they travel and link it that way?" and
// "think we should auto generate the dangerous areas with the routes".
//
// ⚠️ IT IS AN AID TO THE QUESTION, NOT AN ANSWER TO IT. A route between home
// and work says where somebody probably drives on a working morning; it does
// not say where they go on a Saturday, and Maps will happily return a route the
// applicant has never taken because it is forty seconds quicker. So an area on
// the route is PRE-TICKED and stays editable — the member is still the one who
// says where they go, and unticking must be as ordinary as ticking.
//
// ⚠️ AND A ROUTE IS A LINE, NOT A LIST OF SUBURBS. Google returns an encoded
// polyline; the only honest test is geometric — is this area within a few
// kilometres of the line the applicant drives. Reading suburb names out of the
// step instructions would miss every area the road passes without turning in.
//
// PURE — no HTTP, no Nest. The Directions call lives in the service.
// ────────────────────────────────────────────────────────────────────

/**
 * How close to the line an area has to be.
 *
 * ⚠️ THREE KILOMETRES, AND IT IS A JUDGEMENT ABOUT EVIDENCE RATHER THAN ABOUT
 * GEOMETRY. A geocoded suburb is a single point standing for a few square
 * kilometres, so "on the route" cannot mean "on the line". Too tight and a
 * suburb whose centroid sits off the highway is missed; too loose and a
 * motorway pre-ticks half a metro, which puts words in the applicant's mouth on
 * a document they sign.
 */
export const ON_ROUTE_KM = 3;

/**
 * Decode a Google encoded polyline into points.
 *
 * The algorithm is Google's own: signed base-64 varints of successive deltas,
 * each value shifted left one bit with the sign in the low bit, in units of
 * 1e-5 degrees.
 *
 * ⚠️ RETURNS WHAT IT MANAGED, NEVER THROWS. A truncated or malformed polyline
 * costs the pre-tick; it must not cost the member the whole area list, which is
 * useful without any route at all.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  const s = encoded ?? '';
  let i = 0;
  let lat = 0;
  let lng = 0;

  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (i >= s.length) return null;
      byte = s.charCodeAt(i++) - 63;
      if (byte < 0) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      // A varint longer than six groups is not a coordinate, it is noise.
      if (shift > 30) return null;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (i < s.length) {
    const dLat = next();
    if (dLat === null) break;
    const dLng = next();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/**
 * Is this point within `withinKm` of the route?
 *
 * ⚠️ AGAINST THE SEGMENTS, NOT JUST THE VERTICES. Google thins a polyline on
 * long straight stretches, so two consecutive points can be twenty kilometres
 * apart on the N1 — and a suburb sitting halfway along that straight would be
 * "twenty kilometres from the nearest vertex" and missed, on the very road the
 * applicant drives every day.
 */
export function nearRoute(
  point: LatLng,
  route: readonly LatLng[],
  withinKm = ON_ROUTE_KM,
): boolean {
  if (route.length === 0) return false;
  if (route.length === 1) {
    return haversineKm(point.lat, point.lng, route[0].lat, route[0].lng) <= withinKm;
  }
  for (let i = 1; i < route.length; i++) {
    if (segmentDistanceKm(point, route[i - 1], route[i]) <= withinKm) return true;
  }
  return false;
}

/**
 * Distance from a point to a line segment, in kilometres.
 *
 * ⚠️ A FLAT PROJECTION, WHICH IS CORRECT AT THIS SCALE AND NOT AT ANY OTHER.
 * Longitude is scaled by cos(latitude) so a degree east is worth what it is
 * worth at this latitude; over a segment of a few kilometres in South Africa
 * the error is metres. It would be wrong near a pole and wrong across a
 * hemisphere, and this is used for neither.
 */
function segmentDistanceKm(p: LatLng, a: LatLng, b: LatLng): number {
  const KM_PER_DEG = 111.32;
  const cos = Math.cos((p.lat * Math.PI) / 180);
  const x = (v: LatLng) => v.lng * cos * KM_PER_DEG;
  const y = (v: LatLng) => v.lat * KM_PER_DEG;

  const px = x(p);
  const py = y(p);
  const ax = x(a);
  const ay = y(a);
  const bx = x(b);
  const by = y(b);

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // A zero-length segment is a repeated vertex, which Google does emit.
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Which of these placed areas the route passes through.
 *
 * @param placed  areas we managed to geocode. An area with no point cannot be
 *                tested and is simply not returned — it is still offered to the
 *                member, just not pre-ticked.
 */
export function areasOnRoute(
  placed: readonly { key: string; at: LatLng }[],
  route: readonly LatLng[],
  withinKm = ON_ROUTE_KM,
): string[] {
  if (!route.length) return [];
  return placed.filter((a) => nearRoute(a.at, route, withinKm)).map((a) => a.key);
}
