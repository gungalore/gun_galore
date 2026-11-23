// Pure GPX → route parser for community posts. No Nest/Prisma/Cloudinary
// imports: the service maps a `GpxRouteError` to a 400 and stores the result.
//
// ⚠️ THE RAW GPX IS NEVER STORED. This module reduces the upload to the
// simplified, coordinate-only representation the feed uses (segments of
// {lat, lon, ele, speedKph, gradientPct, distM}), plus a handful of metrics and
// an elevation sparkline. Absolute timestamps are read ONLY to derive speed and
// total duration, then thrown away — a downloaded .gpx must not leak when the
// member hiked or where they started.
//
// Security: DOCTYPE/ENTITY declarations are refused before parsing (GPX is
// plain data; an entity is only ever an XXE or billion-laughs vector), invalid
// UTF-8 is refused (the decoded text would carry U+FFFD), and both the source
// point count and the post-simplification size are capped so one upload cannot
// exhaust a worker.
//
// GeoJSON conversion is delegated to @tmcw/togeojson; track features
// (`_gpxType === 'trk'`) win over route features (`rte`) when a file has both.

import { DOMParser } from '@xmldom/xmldom';
import { gpx } from '@tmcw/togeojson';
import type {
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Position,
} from 'geojson';
import { haversineKm } from '../common/geo';
import {
  FEED_MAX_ROUTE_BYTES,
  FEED_MAX_ROUTE_POINTS,
  FEED_MAX_ROUTE_SEGMENTS,
  FEED_MAX_ROUTE_SOURCE_POINTS,
  FEED_MIN_ROUTE_METERS,
  FEED_ROUTE_PROFILE_SAMPLES,
} from './feed.types';

export type RoutePoint = {
  lat: number;
  lon: number;
  ele: number | null;
  speedKph: number | null;
  gradientPct: number | null;
  /** Cumulative distance along the whole route, in metres. */
  distM: number;
};

export type RouteBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type ParsedRoute = {
  segments: RoutePoint[][];
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  minElevationM: number | null;
  maxElevationM: number | null;
  durationSeconds: number | null;
  pointCount: number;
  segmentCount: number;
  hasElevation: boolean;
  hasSpeed: boolean;
  profile: number[] | null;
  bounds: RouteBounds;
};

/**
 * A rejected GPX upload. The SERVICE turns this into a BadRequestException —
 * keeping the parser Nest-free makes it trivially unit-testable and reusable.
 */
export class GpxRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpxRouteError';
  }
}

/** A tiny 2D shape for the feed card; never the stored point list. */
export type RoutePreviewPoint = { lat: number; lon: number };

/**
 * Sample the simplified route down to a card-sized shape. The feed card must
 * not carry `segments` (up to 2,000 points); 60 points is enough to keep a loop
 * or switchback recognisable, and the first/last are always kept.
 */
export function buildRoutePreview(
  segments: ReadonlyArray<ReadonlyArray<Pick<RoutePoint, 'lat' | 'lon'>>>,
  maxPoints = 60,
): RoutePreviewPoint[] {
  const flat: Array<Pick<RoutePoint, 'lat' | 'lon'>> = [];
  for (const segment of segments) {
    for (const point of segment) {
      if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) flat.push(point);
    }
  }
  if (!flat.length) return [];
  const count = Math.max(1, Math.min(maxPoints, flat.length));
  if (count === 1) {
    return [{ lat: round6(flat[0].lat), lon: round6(flat[0].lon) }];
  }
  const step = (flat.length - 1) / (count - 1);
  const out: RoutePreviewPoint[] = [];
  let lastIndex = -1;
  for (let i = 0; i < count; i += 1) {
    const index = Math.min(flat.length - 1, Math.round(i * step));
    if (index === lastIndex) continue;
    lastIndex = index;
    out.push({
      lat: round6(flat[index].lat),
      lon: round6(flat[index].lon),
    });
  }
  return out;
}

/** Douglas–Peucker start tolerance: 2 m keeps a real trail's shape. */
const SIMPLIFY_START_M = 2;
/**
 * ⚠️ Hard ceiling after simplification. FEED_MAX_ROUTE_POINTS is the target;
 * this is the "something is wrong" backstop so a pathological file can never
 * reach the database with more than 2 500 points.
 */
const HARD_POINT_CAP = 2_500;
/** A climb or drop smaller than this is GPS noise, not ascent. */
const ELEVATION_THRESHOLD_M = 2;
/** Metres per degree of latitude (equirectangular projection). */
const METRES_PER_DEGREE = 111_320;
/** Centred-window radius, in points, for speed and gradient. */
const WINDOW_POINTS = 2;
/** Gradient is clamped to ±100% — steeper than a cliff is bad data, not terrain. */
const MAX_GRADIENT_PCT = 100;

interface RawPoint {
  lat: number;
  lon: number;
  ele: number | null;
  /** Derived, never stored. */
  timeMs: number | null;
}

interface LineFeature {
  geometry: LineString | MultiLineString;
  /** Raw `coordinateProperties.times` — shape depends on the geometry type. */
  times: unknown;
  gpxType: string | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  return null;
}

function parseDocument(text: string) {
  // ⚠️ Any SAX error is FATAL here. xmldom's parser only warns by default and
  // hands back a half-built document; a truncated upload must not be silently
  // accepted as a partial route.
  const parser = new DOMParser({
    onError: () => {
      throw new Error('malformed XML');
    },
  });
  try {
    return parser.parseFromString(text, 'application/xml');
  } catch {
    throw new GpxRouteError('The GPX file could not be parsed as XML.');
  }
}

function isLineGeometry(
  geometry: Geometry | null | undefined,
): geometry is LineString | MultiLineString {
  return (
    !!geometry &&
    (geometry.type === 'LineString' || geometry.type === 'MultiLineString')
  );
}

/** Build the valid, timestamp-aligned points of one GPX segment. */
function buildSegment(coordinates: Position[], rawTimes: unknown): RawPoint[] {
  const times = Array.isArray(rawTimes) ? rawTimes : [];
  const points: RawPoint[] = [];
  for (let i = 0; i < coordinates.length; i += 1) {
    const position = coordinates[i];
    if (!Array.isArray(position) || position.length < 2) continue;
    const lon = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const rawEle = position[2];
    const ele =
      typeof rawEle === 'number' && Number.isFinite(rawEle) ? rawEle : null;
    points.push({ lat, lon, ele, timeMs: parseTimeMs(times[i]) });
  }
  return points;
}

function haversineM(a: RawPoint, b: RawPoint): number {
  return haversineKm({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }) * 1000;
}

function segmentLengthM(points: RawPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineM(points[i - 1], points[i]);
  return total;
}

/** Local metre projection for Douglas–Peucker (equirectangular, per segment). */
function projectToMetres(points: RawPoint[]): { x: number; y: number }[] {
  const origin = points[0];
  const kx = METRES_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  return points.map((p) => ({
    x: (p.lon - origin.lon) * kx,
    y: (p.lat - origin.lat) * METRES_PER_DEGREE,
  }));
}

/**
 * Douglas–Peucker simplification that keeps the retained points' timestamps
 * aligned (indices are tracked, not values), so duration and speed are measured
 * on exactly the points that get stored.
 *
 * Coordinates are projected once into typed arrays: the inner scan runs up to
 * n² times in the worst case (a dense zigzag), so property access here is the
 * difference between a fast parse and a worker-blocking one.
 */
function simplifySegment(points: RawPoint[], toleranceM: number): RawPoint[] {
  if (points.length <= 2) return points.slice();
  const projected = projectToMetres(points);
  const xs = new Float64Array(points.length);
  const ys = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    xs[i] = projected[i].x;
    ys[i] = projected[i].y;
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    if (end <= start + 1) continue;
    const dx = xs[end] - xs[start];
    const dy = ys[end] - ys[start];
    const length = Math.sqrt(dx * dx + dy * dy);
    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance =
        length === 0
          ? Math.hypot(xs[i] - xs[start], ys[i] - ys[start])
          : Math.abs(dx * (ys[start] - ys[i]) - (xs[start] - xs[i]) * dy) / length;
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    if (maxDistance > toleranceM && maxIndex > -1) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Speed from a centred window inside one segment; null where unavailable. */
function speedAt(
  points: RawPoint[],
  distances: number[],
  index: number,
): number | null {
  const first = Math.max(0, index - WINDOW_POINTS);
  const last = Math.min(points.length - 1, index + WINDOW_POINTS);
  if (first === last) return null;
  const start = points[first].timeMs;
  const end = points[last].timeMs;
  if (start === null || end === null) return null;
  const seconds = (end - start) / 1000;
  if (seconds <= 0) return null;
  const metres = distances[last] - distances[first];
  if (!Number.isFinite(metres)) return null;
  return round1((metres / seconds) * 3.6);
}

/** Rise/run percent over a centred window; null without elevation. */
function gradientAt(
  points: RawPoint[],
  distances: number[],
  index: number,
): number | null {
  const first = Math.max(0, index - WINDOW_POINTS);
  const last = Math.min(points.length - 1, index + WINDOW_POINTS);
  if (first === last) return null;
  const low = points[first].ele;
  const high = points[last].ele;
  if (low === null || high === null) return null;
  const run = distances[last] - distances[first];
  if (!(run >= 0.5)) return null;
  const pct = ((high - low) / run) * 100;
  if (!Number.isFinite(pct)) return null;
  return round1(Math.max(-MAX_GRADIENT_PCT, Math.min(MAX_GRADIENT_PCT, pct)));
}

/** Even-distance elevation samples for the feed's sparkline. */
function elevationProfile(
  segments: RawPoint[][],
  distances: number[][],
  totalM: number,
): number[] | null {
  const samples: { d: number; e: number }[] = [];
  segments.forEach((points, segmentIndex) => {
    points.forEach((point, index) => {
      if (point.ele !== null) {
        samples.push({ d: distances[segmentIndex][index], e: point.ele });
      }
    });
  });
  if (!samples.length) return null;
  const last = samples[samples.length - 1];
  const elevationAt = (target: number): number => {
    if (target <= samples[0].d) return samples[0].e;
    if (target >= last.d) return last.e;
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].d >= target) {
        const before = samples[i - 1];
        const after = samples[i];
        const span = after.d - before.d;
        if (span <= 0) return after.e;
        const ratio = (target - before.d) / span;
        return before.e + ratio * (after.e - before.e);
      }
    }
    return last.e;
  };
  const profile: number[] = [];
  for (let sample = 0; sample < FEED_ROUTE_PROFILE_SAMPLES; sample += 1) {
    const target =
      (totalM * sample) / (FEED_ROUTE_PROFILE_SAMPLES - 1);
    profile.push(Math.round(elevationAt(target)));
  }
  return profile;
}

function assertNoDangerousMarkup(text: string): void {
  if (text.includes('\uFFFD')) {
    throw new GpxRouteError('The GPX file is not valid UTF-8 text.');
  }
  // ⚠️ Case-insensitive: XML is case-sensitive but an attacker is not limited
  // to the canonical spelling, and no legitimate GPX needs either declaration.
  if (/<!doctype/i.test(text) || /<!entity/i.test(text)) {
    throw new GpxRouteError(
      'The GPX file contains a document type or entity declaration, which cannot be accepted.',
    );
  }
}

/**
 * Parse a GPX upload into the simplified route the feed stores.
 *
 * @throws GpxRouteError when the file is not a usable route.
 */
export function parseGpxRoute(text: string): ParsedRoute {
  if (typeof text !== 'string' || !text.trim()) {
    throw new GpxRouteError('The GPX file is empty.');
  }
  assertNoDangerousMarkup(text);
  if (Buffer.byteLength(text, 'utf8') > FEED_MAX_ROUTE_BYTES) {
    throw new GpxRouteError('The GPX file is too large.');
  }

  const document = parseDocument(text);
  let collection: FeatureCollection;
  try {
    collection = gpx(document as never);
  } catch {
    throw new GpxRouteError('This file is not a valid GPX document.');
  }

  // ── Collect the line features we may use, enforcing the source-point cap ──
  let sourcePoints = 0;
  const lineFeatures: LineFeature[] = [];
  for (const feature of collection.features ?? []) {
    const geometry = feature.geometry;
    if (!isLineGeometry(geometry)) continue;
    const segments =
      geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    for (const segment of segments) {
      sourcePoints += segment.length;
      if (sourcePoints > FEED_MAX_ROUTE_SOURCE_POINTS) {
        throw new GpxRouteError(
          `A GPX route can carry at most ${FEED_MAX_ROUTE_SOURCE_POINTS.toLocaleString('en-ZA')} points.`,
        );
      }
    }
    const properties = (feature.properties ?? {}) as {
      _gpxType?: unknown;
      coordinateProperties?: { times?: unknown };
    };
    lineFeatures.push({
      geometry,
      times: properties.coordinateProperties?.times,
      // Point features are dropped above; route/track are the only line kinds.
      gpxType: typeof properties._gpxType === 'string' ? properties._gpxType : null,
    });
  }

  // ⚠️ TRACKS WIN. A file carrying both a planned route and the recorded track
  // should show the track (what was actually walked); mixing the two would
  // double the distance and break the segment count.
  const tracks = lineFeatures.filter((feature) => feature.gpxType === 'trk');
  const chosen = tracks.length
    ? tracks
    : lineFeatures.filter((feature) => feature.gpxType === 'rte');
  if (!chosen.length) {
    throw new GpxRouteError('This GPX file has no track or route.');
  }

  const rawSegments: RawPoint[][] = [];
  for (const feature of chosen) {
    if (feature.geometry.type === 'LineString') {
      rawSegments.push(buildSegment(feature.geometry.coordinates, feature.times));
    } else {
      const timesPerSegment = Array.isArray(feature.times) ? feature.times : [];
      feature.geometry.coordinates.forEach((coordinates, index) => {
        rawSegments.push(buildSegment(coordinates, timesPerSegment[index]));
      });
    }
  }

  // A segment with fewer than two usable points cannot describe a line; drop it
  // rather than fail the whole route (waypoint-only or truncated last segments
  // are common in exported files).
  const segments = rawSegments.filter((segment) => segment.length >= 2);
  if (!segments.length) {
    throw new GpxRouteError(
      'This GPX route does not contain a track with at least two points.',
    );
  }
  if (segments.length > FEED_MAX_ROUTE_SEGMENTS) {
    throw new GpxRouteError(
      `This GPX route has too many segments (at most ${FEED_MAX_ROUTE_SEGMENTS}).`,
    );
  }

  const sourceDistanceM = segments.reduce(
    (total, segment) => total + segmentLengthM(segment),
    0,
  );
  if (sourceDistanceM < FEED_MIN_ROUTE_METERS) {
    throw new GpxRouteError(
      `This route is too short — a GPX route must cover at least ${FEED_MIN_ROUTE_METERS} m.`,
    );
  }

  // ── Simplify: raise the tolerance until the stored size fits ─────────────
  let toleranceM = SIMPLIFY_START_M;
  let simplified = segments.map((segment) => simplifySegment(segment, toleranceM));
  let pointCount = simplified.reduce((total, segment) => total + segment.length, 0);
  for (let attempt = 0; attempt < 32 && pointCount > FEED_MAX_ROUTE_POINTS; attempt += 1) {
    toleranceM *= 2;
    simplified = segments.map((segment) => simplifySegment(segment, toleranceM));
    pointCount = simplified.reduce((total, segment) => total + segment.length, 0);
  }
  if (pointCount > HARD_POINT_CAP) {
    throw new GpxRouteError('This route is too complex to store.');
  }

  // ── Metrics over the SIMPLIFIED points (the ones that get stored) ────────
  const distances: number[][] = [];
  let cumulativeM = 0;
  let hasElevation = false;
  let hasSpeed = false;
  let ascentM = 0;
  let descentM = 0;
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const segment of simplified) {
    // The gap between two track segments is not walked terrain, so the 2 m
    // noise threshold must not carry an elevation baseline across it.
    let lastElevation: number | null = null;
    const segmentDistances: number[] = [];
    for (let i = 0; i < segment.length; i += 1) {
      const point = segment[i];
      if (i > 0) cumulativeM += haversineM(segment[i - 1], point);
      segmentDistances.push(round1(cumulativeM));
      if (point.lat < south) south = point.lat;
      if (point.lat > north) north = point.lat;
      if (point.lon < west) west = point.lon;
      if (point.lon > east) east = point.lon;
      if (point.ele !== null) {
        hasElevation = true;
        if (point.ele < minElevation) minElevation = point.ele;
        if (point.ele > maxElevation) maxElevation = point.ele;
        if (lastElevation === null) {
          lastElevation = point.ele;
        } else {
          const change = point.ele - lastElevation;
          if (change >= ELEVATION_THRESHOLD_M) {
            ascentM += change;
            lastElevation = point.ele;
          } else if (change <= -ELEVATION_THRESHOLD_M) {
            descentM += -change;
            lastElevation = point.ele;
          }
        }
      }
    }
    distances.push(segmentDistances);
  }

  const segmentsOut: RoutePoint[][] = [];
  // Duration is the sum of each segment's own elapsed time: the gap between two
  // segments is not elapsed travel time, so it must not be added.
  let durationSeconds: number | null = null;
  for (let segmentIndex = 0; segmentIndex < simplified.length; segmentIndex += 1) {
    const segment = simplified[segmentIndex];
    const first = segment[0].timeMs;
    const last = segment[segment.length - 1].timeMs;
    if (first !== null && last !== null && last >= first) {
      durationSeconds = (durationSeconds ?? 0) + (last - first) / 1000;
    }
    segmentsOut.push(
      segment.map((point, index) => {
        const speedKph = speedAt(segment, distances[segmentIndex], index);
        if (speedKph !== null) hasSpeed = true;
        return {
          lat: round6(point.lat),
          lon: round6(point.lon),
          ele: point.ele === null ? null : round1(point.ele),
          speedKph,
          gradientPct: gradientAt(segment, distances[segmentIndex], index),
          distM: distances[segmentIndex][index],
        };
      }),
    );
  }
  const distanceM = Math.round(cumulativeM);
  const bounds: RouteBounds = {
    south,
    west,
    north,
    east,
  };

  return {
    segments: segmentsOut,
    distanceM,
    ascentM: hasElevation ? Math.round(ascentM) : null,
    descentM: hasElevation ? Math.round(descentM) : null,
    minElevationM: hasElevation ? Math.round(minElevation) : null,
    maxElevationM: hasElevation ? Math.round(maxElevation) : null,
    durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds),
    pointCount,
    segmentCount: segmentsOut.length,
    hasElevation,
    hasSpeed,
    profile: elevationProfile(simplified, distances, cumulativeM),
    bounds,
  };
}
