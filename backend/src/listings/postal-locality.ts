/**
 * Postal-code area — the label a buyer sees for where an item is.
 *
 * A postal code names an AREA, not a metro. Google's `locality` for a
 * Kraaifontein address is "Cape Town", which tells a buyer nothing about the
 * drive; code 7570 names "Kraaifontein". We resolve the area from the bundled
 * GeoNames postal dataset (backend/data/sa-postal-codes-geonames.tsv) and fall
 * back to the town Google gave us when the code is unknown.
 *
 * GRANULARITY. This publishes a postal area, never the pickup street, unit or
 * the raw `pickupSuburb` field. `pickupSuburb` is used ONLY to choose between
 * the place names attached to one code (7530 lists both Bellville and Cape
 * Town); it never reaches the response on its own. `pickupPostalCode` and the
 * rest of `pickup*` stay on PUBLIC_LISTING_SELECT's NEVER list.
 *
 * Many codes list several place names and GeoNames has no "primary" one, so:
 *   1. an exact suburb match wins (Bellville over Cape Town for 7530);
 *   2. a single name wins outright (7570 → Kraaifontein);
 *   3. otherwise the name nearest the seller's own coordinates wins;
 *   4. no usable signal → null, and the caller keeps the town fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { toPublicLocality } from './locality';

type PostalArea = {
  place: string;
  lat: number;
  lng: number;
};

let index: Map<string, PostalArea[]> | null = null;

function candidateFiles(): string[] {
  return [
    path.join(process.cwd(), 'data', 'sa-postal-codes-geonames.tsv'),
    path.join(__dirname, '..', '..', '..', 'data', 'sa-postal-codes-geonames.tsv'),
    path.join(__dirname, '..', '..', 'data', 'sa-postal-codes-geonames.tsv'),
  ];
}

/** Parse GeoNames ZA.txt: country | postal | placeName | … | lat | lng. */
function loadIndex(): Map<string, PostalArea[]> {
  if (index) return index;
  const map = new Map<string, PostalArea[]>();
  index = map;

  const file = candidateFiles().find((p) => fs.existsSync(p));
  if (!file) return map;

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return map;
  }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('ZA\t')) continue;
    const parts = line.split('\t');
    const code = (parts[1] ?? '').trim();
    const place = toPublicLocality(parts[2] ?? '');
    const lat = Number.parseFloat(parts[9] ?? '');
    const lng = Number.parseFloat(parts[10] ?? '');
    if (!code || !place) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;
    const list = map.get(code);
    if (list) list.push({ place, lat, lng });
    else map.set(code, [{ place, lat, lng }]);
  }
  return map;
}

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The postal area for a code — "Kraaifontein" for 7570 — or null when the
 * code is unknown and there is no safe way to choose a name.
 */
export function resolvePostalArea(input: {
  postalCode?: string | null;
  suburb?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string | null {
  const code = (input.postalCode ?? '').trim().replace(/\s+/g, '');
  if (!/^\d{4}$/.test(code)) return null;

  const areas = loadIndex().get(code);
  if (!areas || areas.length === 0) return null;

  const wanted = normalise(input.suburb);
  if (wanted) {
    const exact = areas.find((a) => normalise(a.place) === wanted);
    if (exact) return exact.place;
  }

  const unique = Array.from(new Set(areas.map((a) => a.place)));
  if (unique.length === 1) return unique[0];

  const lat = input.lat;
  const lng = input.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    let best: PostalArea | null = null;
    let bestKm = Infinity;
    for (const area of areas) {
      const km = haversineKm(lat, lng, area.lat, area.lng);
      if (km < bestKm) {
        bestKm = km;
        best = area;
      }
    }
    if (best) return best.place;
  }

  return null;
}
