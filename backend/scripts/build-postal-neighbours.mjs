// One-off build script — computes the postal-code neighbour map from
// the GeoNames SA postal-code dataset and writes it to
// backend/data/postal-neighbours.json. Run on demand:
//
//   node scripts/build-postal-neighbours.mjs
//
// Input:  data/sa-postal-codes-geonames.tsv   (GeoNames ZA.zip → ZA.txt)
// Output: data/postal-neighbours.json
//
// Why Delaunay (not centroid-radius or pre-built polygons):
//   - SA postal codes have no formally surveyed boundaries; any
//     polygon dataset on the net is itself a Voronoi tessellation
//     built from centroids. We skip that intermediate step.
//   - Delaunay edges are the dual of Voronoi cells. Two postal codes
//     share a Voronoi border iff their centroids share a Delaunay
//     edge — exactly the "neighbour" we want for the locker picker.
//   - O(n log n) once at build time; the runtime lookup is an array
//     read.
//
// Output shape:
//   {
//     "version": 1,
//     "generatedAt": "2026-05-20T...",
//     "neighbours": {
//       "7570": ["7530", "7550", "7560", "7580", ...],
//       ...
//     }
//   }

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Delaunay } from 'd3-delaunay';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const INPUT = path.join(DATA_DIR, 'sa-postal-codes-geonames.tsv');
const OUTPUT = path.join(DATA_DIR, 'postal-neighbours.json');

// Sanity cap: Voronoi triangulation can connect very distant points
// when there's nothing between them (e.g. a postal code in Pofadder
// becoming a "neighbour" of one in Upington 200km away). We drop
// edges longer than this so the neighbour list stays semantically
// useful for a locker picker.
const MAX_NEIGHBOUR_DISTANCE_KM = 30;

// Some Voronoi cells in dense urban areas have 8+ neighbours; rural
// cells can have 12+. Cap so the JSON doesn't bloat for outliers
// and the runtime lookup stays predictable. The locker matcher only
// needs the nearest handful anyway.
const MAX_NEIGHBOURS_PER_CODE = 10;

// ─── Step 1 — parse GeoNames TSV ────────────────────────────────────────────
//
// GeoNames postal-code format (tab-separated):
//   country | postal | placeName | adminName1 | adminCode1 |
//   adminName2 | adminCode2 | adminName3 | adminCode3 | lat | lng | accuracy

console.log(`Reading ${INPUT}`);
const raw = fs.readFileSync(INPUT, 'utf8');
const lines = raw.split(/\r?\n/).filter(Boolean);
console.log(`Parsed ${lines.length} rows`);

/** @type {{ code: string, lat: number, lng: number, place: string }[]} */
const rows = [];
for (const line of lines) {
  const parts = line.split('\t');
  const code = (parts[1] ?? '').trim();
  const place = (parts[2] ?? '').trim();
  const lat = parseFloat(parts[9] ?? '');
  const lng = parseFloat(parts[10] ?? '');
  if (!code || Number.isNaN(lat) || Number.isNaN(lng)) continue;
  if (lat === 0 && lng === 0) continue;
  rows.push({ code, lat, lng, place });
}
console.log(`Valid rows with coords: ${rows.length}`);

// ─── Step 2 — dedup by coords ───────────────────────────────────────────────
//
// Multiple postal codes in GeoNames share the same lat/lng (e.g. PO
// box ranges 0001–0083 all sitting on Pretoria's centroid). For the
// triangulation we need a UNIQUE set of points; we keep a mapping
// back from each point to all codes that share it so the final
// neighbour map can resolve all of them.

const pointKey = (lat, lng) => `${lat.toFixed(5)}|${lng.toFixed(5)}`;
/** @type {Map<string, { lat: number, lng: number, codes: string[] }>} */
const pointMap = new Map();
for (const r of rows) {
  const key = pointKey(r.lat, r.lng);
  const existing = pointMap.get(key);
  if (existing) {
    if (!existing.codes.includes(r.code)) existing.codes.push(r.code);
  } else {
    pointMap.set(key, { lat: r.lat, lng: r.lng, codes: [r.code] });
  }
}
const points = Array.from(pointMap.values());
console.log(`Unique coordinate points: ${points.length}`);

// ─── Step 3 — Delaunay triangulation ────────────────────────────────────────
//
// d3-delaunay takes a flat [x0, y0, x1, y1, ...] array. We use
// (lng, lat) as (x, y); the slight projection error doesn't matter
// at the 30 km cap.
const coords = new Float64Array(points.length * 2);
for (let i = 0; i < points.length; i++) {
  coords[i * 2] = points[i].lng;
  coords[i * 2 + 1] = points[i].lat;
}
console.log('Triangulating…');
const delaunay = new Delaunay(coords);

// ─── Step 4 — extract adjacency + cap distance ──────────────────────────────
//
// For each point i, delaunay.neighbors(i) yields the indices of
// points that share a triangle with i. We map back to postal codes,
// dedupe, sort by distance from i, and cap at MAX_NEIGHBOURS_PER_CODE.

function haversineKm(lat1, lng1, lat2, lng2) {
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

console.log('Building neighbour map…');
/** @type {Record<string, string[]>} */
const neighboursByCode = {};

for (let i = 0; i < points.length; i++) {
  const self = points[i];
  const nbrIndices = Array.from(delaunay.neighbors(i));

  // Score neighbours by distance + drop anything past the cap.
  const scored = [];
  for (const j of nbrIndices) {
    const other = points[j];
    const d = haversineKm(self.lat, self.lng, other.lat, other.lng);
    if (d > MAX_NEIGHBOUR_DISTANCE_KM) continue;
    scored.push({ point: other, distanceKm: d });
  }
  scored.sort((a, b) => a.distanceKm - b.distanceKm);

  // Collect codes from the neighbouring points + cap.
  const collected = new Set();
  for (const s of scored) {
    for (const code of s.point.codes) collected.add(code);
    if (collected.size >= MAX_NEIGHBOURS_PER_CODE) break;
  }

  // Every code at THIS point shares the same neighbour set.
  for (const code of self.codes) {
    // Exclude self-codes (codes at the same point are sub-codes of
    // the same locality; we treat them as "exact match" upstream,
    // not neighbours).
    const list = Array.from(collected).filter((c) => !self.codes.includes(c));
    neighboursByCode[code] = list.slice(0, MAX_NEIGHBOURS_PER_CODE);
  }
}

// ─── Step 5 — write JSON ────────────────────────────────────────────────────

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'GeoNames ZA.zip',
  maxNeighbourDistanceKm: MAX_NEIGHBOUR_DISTANCE_KM,
  maxNeighboursPerCode: MAX_NEIGHBOURS_PER_CODE,
  totalCodes: Object.keys(neighboursByCode).length,
  neighbours: neighboursByCode,
};

fs.writeFileSync(OUTPUT, JSON.stringify(output));
const sizeKb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.log(
  `Wrote ${OUTPUT} (${sizeKb} KB) — ${output.totalCodes} codes, ` +
    `≤${MAX_NEIGHBOURS_PER_CODE} neighbours each, ≤${MAX_NEIGHBOUR_DISTANCE_KM} km`,
);

// Spot check — print 7570's neighbours so we can verify against the
// real-world expectation (Durbanville / Sonstraal area; should
// include Brackenfell / Bellville-adjacent codes).
const sample = '7570';
if (neighboursByCode[sample]) {
  console.log(`Sample — ${sample} neighbours:`, neighboursByCode[sample]);
} else {
  console.log(`Sample — ${sample} not present in dataset`);
}
