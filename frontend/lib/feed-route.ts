// Pure helpers for the community GPX route viewer. NO React, NO DOM, NO
// MapLibre: everything here is a function of the route data, so the specs run
// in the node environment and the map component stays a thin shell over these.
//
// ⚠️ THE API IS THE SOURCE OF TRUTH FOR `distM`. The backend measures distance
// along the GPX (including the gaps between segments) and sends it with every
// point; flattening must NOT re-derive it or the chart and the point labels
// would disagree with the summary by a few metres. `haversineMeters` is here
// only for the fallback when a point arrives without one, and for the map's
// click-to-nearest-point hit test.

import type { FeedRoute, FeedRoutePoint } from './community-api';

/** Shown wherever a GPX field is simply absent. */
export const MISSING_VALUE = '—';

/** The sentence the UI uses when a field was not in the uploaded GPX. */
export const NOT_IN_GPX = 'not in this GPX';

// ── Formatting ─────────────────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Thousands-separated integer, e.g. 1240 -> "1,240".
 *
 * ⚠️ NOT `toLocaleString()`: the string is rendered on the server (Node, full
 * ICU) and hydrated in the browser (whatever locale the member has), and for
 * en-ZA they disagree about the separator — React then reports a hydration
 * mismatch for a perfectly correct number. Fixed grouping is deterministic in
 * both places.
 */
function groupThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `850 m` / `12.4 km`. Null/garbage -> the missing dash. */
export function formatDistance(meters: number | null | undefined): string {
  if (!isFiniteNumber(meters)) return MISSING_VALUE;
  const rounded = Math.round(meters);
  if (Math.abs(rounded) < 1000) return `${rounded} m`;
  return `${(rounded / 1000).toFixed(1)} km`;
}

/** `1,240 m`. Used for elevation, ascent and descent. */
export function formatElevation(meters: number | null | undefined): string {
  if (!isFiniteNumber(meters)) return MISSING_VALUE;
  return `${groupThousands(meters)} m`;
}

/** Cumulative climb, e.g. `420 m`. Absent -> dash. */
export function formatAscent(meters: number | null | undefined): string {
  return formatElevation(meters);
}

/** Cumulative descent, e.g. `310 m`. Absent -> dash. */
export function formatDescent(meters: number | null | undefined): string {
  return formatElevation(meters);
}

/**
 * `2 h 10 m` / `34 m` / `42 s`. Seconds are only shown under a minute — a
 * route duration is a rounded walk time, not a stopwatch, and "2 h 10 m 12 s"
 * reads as precision the GPX does not have.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return MISSING_VALUE;
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

/** `4.8 km/h`. Negative values (a bad timestamp pair) read as 0. */
export function formatSpeed(kph: number | null | undefined): string {
  if (!isFiniteNumber(kph)) return MISSING_VALUE;
  return `${Math.max(0, kph).toFixed(1)} km/h`;
}

/**
 * Signed percent, e.g. `+6.3%`, `-2.1%`, `0.0%`. POSITIVE IS A CLIMB — the
 * sign is the whole point of the field, so it is never dropped for positives.
 */
export function formatGradient(pct: number | null | undefined): string {
  if (!isFiniteNumber(pct)) return MISSING_VALUE;
  const value = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/** `4.2 km · 1,240 m · 4.8 km/h · +6.3%` — absent fields become `—`. */
export function formatPointLabel(
  point: Pick<FeedRoutePoint, 'distM' | 'ele' | 'speedKph' | 'gradientPct'>,
): string {
  return [
    formatDistance(point.distM),
    formatElevation(point.ele),
    formatSpeed(point.speedKph),
    formatGradient(point.gradientPct),
  ].join(' · ');
}

// ── Flattening ─────────────────────────────────────────────────────────────

/** A route point plus the segment it came from and its position in the route. */
export interface FlatRoutePoint extends FeedRoutePoint {
  segmentIndex: number;
  /** Position in the flattened route — what `selectedIndex` refers to. */
  index: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(
  a: Pick<FeedRoutePoint, 'lat' | 'lon'>,
  b: Pick<FeedRoutePoint, 'lat' | 'lon'>,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * One ordered list of every point, in GPX order, carrying `segmentIndex`.
 * Segment boundaries are preserved only by that index — the viewer draws the
 * whole route as one series and does not invent a distance between segments.
 */
export function flattenRoute(
  route: Pick<FeedRoute, 'segments'> | null | undefined,
): FlatRoutePoint[] {
  if (!route?.segments?.length) return [];
  const out: FlatRoutePoint[] = [];
  let runningDistance = 0;
  route.segments.forEach((segment, segmentIndex) => {
    if (!Array.isArray(segment)) return;
    segment.forEach((point) => {
      const previous = out[out.length - 1];
      runningDistance = isFiniteNumber(point.distM)
        ? point.distM
        : previous
          ? previous.distM + haversineMeters(previous, point)
          : 0;
      out.push({ ...point, segmentIndex, index: out.length, distM: runningDistance });
    });
  });
  return out;
}

/** Index of the closest route point to `lat`/`lon`, or -1 for an empty route. */
export function nearestPointIndex(
  points: ReadonlyArray<Pick<FeedRoutePoint, 'lat' | 'lon'>>,
  lat: number,
  lon: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = haversineMeters(points[i], { lat, lon });
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** Linear interpolation of an optional numeric field; a missing end means no data. */
function lerpOptional(
  a: number | null,
  b: number | null,
  t: number,
): number | null {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  return a + (b - a) * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Resample the simplified route at a regular distance so the inspector's
 * slider moves like a slider rather than stepping between a handful of stored
 * vertices. A 9-point, 8 km track otherwise jumps about a kilometre per notch;
 * at ~5 m spacing the same track has ~1,600 inspectable positions without
 * changing the stored route or its metrics.
 *
 * ⚠️ THE STORED ROUTE IS NOT REPLACED. This is a client-side display series:
 * the map line, chart, slider and point markers use it; the GPX download and
 * every server response keep the original simplified points.
 */
export function densifyRoute(
  segments: ReadonlyArray<ReadonlyArray<FeedRoutePoint>> | null | undefined,
  options: { maxPoints?: number; minStepM?: number } = {},
): FeedRoutePoint[][] {
  const maxPoints = Math.max(2, options.maxPoints ?? 2_000);
  const minStepM = Math.max(0.5, options.minStepM ?? 5);
  const input = (segments ?? []).filter(
    (segment) => Array.isArray(segment) && segment.length > 0,
  );
  if (!input.length) return [];

  const totalDistanceM = input.reduce((total, segment) => {
    const last = segment[segment.length - 1];
    return Math.max(total, isFiniteNumber(last?.distM) ? last.distM : 0);
  }, 0);
  const step = Math.max(minStepM, totalDistanceM / maxPoints);
  const out: FeedRoutePoint[][] = [];

  for (const segment of input) {
    if (segment.length === 1) {
      out.push([{ ...segment[0] }]);
      continue;
    }
    const dense: FeedRoutePoint[] = [{ ...segment[0] }];
    for (let i = 1; i < segment.length; i += 1) {
      const from = segment[i - 1];
      const to = segment[i];
      const span = to.distM - from.distM;
      if (!(span > 0)) {
        dense.push({ ...to });
        continue;
      }
      // Fill fixed-distance samples between the two stored vertices, then the
      // vertex itself, so every original point survives.
      let next = dense[dense.length - 1].distM + step;
      while (next < to.distM - 0.01) {
        const t = Math.min(1, Math.max(0, (next - from.distM) / span));
        dense.push({
          lat: round6(lerp(from.lat, to.lat, t)),
          lon: round6(lerp(from.lon, to.lon, t)),
          ele: lerpOptional(from.ele, to.ele, t),
          speedKph: lerpOptional(from.speedKph, to.speedKph, t),
          gradientPct: lerpOptional(from.gradientPct, to.gradientPct, t),
          distM: round1(next),
        });
        next += step;
      }
      dense.push({ ...to });
    }
    out.push(dense);
  }
  return out;
}

// ── Elevation geometry ─────────────────────────────────────────────────────

export interface ElevationGeometryPoint {
  /** x in the 0..width viewBox (cumulative distance). */
  x: number;
  /** y in the 0..height viewBox (elevation). */
  y: number;
  ele: number;
  distM: number;
  /** Index in the input array, so a selection can be mapped back. */
  index: number;
}

export interface ElevationGeometry {
  width: number;
  height: number;
  minEle: number;
  maxEle: number;
  points: ElevationGeometryPoint[];
  /** Open path: `M x,y L x,y …`. */
  linePath: string;
  /** Closed path down to the baseline, for the area fill. */
  areaPath: string;
}

export interface ElevationGeometryOptions {
  /** ViewBox width. Defaults to 100 (the "0..100" sketch space). */
  width?: number;
  /** ViewBox height. Defaults to 100. */
  height?: number;
  /** Vertical breathing room inside the viewBox, in viewBox units. */
  padY?: number;
}

interface ElevationSample {
  distM: number;
  ele: number;
  index: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildElevationGeometryFromSamples(
  samples: ReadonlyArray<ElevationSample>,
  options: ElevationGeometryOptions = {},
): ElevationGeometry | null {
  if (samples.length < 2) return null;
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const padY = options.padY ?? 6;

  const minEle = Math.min(...samples.map((s) => s.ele));
  const maxEle = Math.max(...samples.map((s) => s.ele));
  const firstDist = samples[0].distM;
  const lastDist = samples[samples.length - 1].distM;

  const usableHeight = Math.max(1, height - padY * 2);
  const eleSpan = maxEle - minEle;

  const points: ElevationGeometryPoint[] = samples.map((sample, order) => {
    const distanceFraction =
      lastDist > firstDist
        ? (sample.distM - firstDist) / (lastDist - firstDist)
        : order / (samples.length - 1);
    const eleFraction =
      eleSpan > 0 ? (sample.ele - minEle) / eleSpan : 0.5;
    return {
      x: round2(distanceFraction * width),
      y: round2(padY + (1 - eleFraction) * usableHeight),
      ele: sample.ele,
      distM: sample.distM,
      index: sample.index,
    };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${round2(p.x)} ${round2(p.y)}`)
    .join(' ');
  const firstX = round2(points[0].x);
  const lastX = round2(points[points.length - 1].x);
  const areaPath = `${linePath} L ${lastX} ${round2(height)} L ${firstX} ${round2(
    height,
  )} Z`;

  return { width, height, minEle, maxEle, points, linePath, areaPath };
}

/**
 * Area-chart geometry over cumulative distance, in a 0..100 viewBox by
 * default. Null when there are fewer than two elevation samples — the caller
 * shows the "no elevation data" note in that case.
 */
export function buildElevationGeometry(
  points: ReadonlyArray<{ distM: number; ele: number | null }>,
  options: ElevationGeometryOptions = {},
): ElevationGeometry | null {
  const samples: ElevationSample[] = [];
  points.forEach((point, index) => {
    if (isFiniteNumber(point.ele) && isFiniteNumber(point.distM)) {
      samples.push({ distM: point.distM, ele: point.ele, index });
    }
  });
  return buildElevationGeometryFromSamples(samples, options);
}

/**
 * The same drawing for the summary's `profile: number[]` — evenly spaced
 * samples with no distances of their own, so x is the sample index.
 */
export function buildProfileGeometry(
  profile: ReadonlyArray<number | null> | null | undefined,
  options: ElevationGeometryOptions = {},
): ElevationGeometry | null {
  if (!profile?.length) return null;
  const samples: ElevationSample[] = [];
  profile.forEach((ele, index) => {
    if (isFiniteNumber(ele)) samples.push({ distM: index, ele, index });
  });
  return buildElevationGeometryFromSamples(samples, options);
}

// ── GeoJSON for MapLibre ───────────────────────────────────────────────────

export interface RouteLineFeature {
  type: 'Feature';
  /** Segment position, so the map can style/select one segment if needed. */
  properties: { segmentIndex: number; pointCount: number };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface RouteLineCollection {
  type: 'FeatureCollection';
  features: RouteLineFeature[];
}

/** One 2D LineString per GPX segment, in [lon, lat] order for MapLibre. */
export function buildRouteGeoJSON(
  segments: ReadonlyArray<ReadonlyArray<Pick<FeedRoutePoint, 'lat' | 'lon'>>> | null | undefined,
): RouteLineCollection {
  const features: RouteLineFeature[] = [];
  (segments ?? []).forEach((segment, segmentIndex) => {
    if (!Array.isArray(segment) || segment.length < 2) return;
    features.push({
      type: 'Feature',
      properties: { segmentIndex, pointCount: segment.length },
      geometry: {
        type: 'LineString',
        coordinates: segment.map((point) => [point.lon, point.lat]),
      },
    });
  });
  return { type: 'FeatureCollection', features };
}

export interface SelectedPointCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { index: number };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
}

/** The selected-point marker source; an empty collection when nothing is selected. */
export function buildSelectedPointGeoJSON(
  point: Pick<FeedRoutePoint, 'lat' | 'lon'> | null | undefined,
  index: number,
): SelectedPointCollection {
  if (!point || !isFiniteNumber(point.lat) || !isFiniteNumber(point.lon)) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { index },
        geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
      },
    ],
  };
}

// ── Projected SVG sketch (the no-map fallback) ─────────────────────────────

export interface ProjectedRoutePoint {
  x: number;
  y: number;
  index: number;
}

export interface ProjectedRouteSegment {
  segmentIndex: number;
  d: string;
  points: ProjectedRoutePoint[];
}

export interface ProjectedRoute {
  width: number;
  height: number;
  segments: ProjectedRouteSegment[];
}

export interface ProjectedRouteOptions {
  width?: number;
  height?: number;
  /** Uniform border inside the viewBox, in viewBox units. */
  padding?: number;
}

/**
 * Equirectangular projection of the route into an SVG viewBox. Longitude is
 * scaled by cos(mean latitude) so a route does not look stretched east-west at
 * South African latitudes, and one uniform scale keeps the shape recognisable.
 */
export function projectRoute(
  segments: ReadonlyArray<ReadonlyArray<Pick<FeedRoutePoint, 'lat' | 'lon'>>> | null | undefined,
  options: ProjectedRouteOptions = {},
): ProjectedRoute | null {
  const width = options.width ?? 320;
  const height = options.height ?? 220;
  const padding = options.padding ?? 12;

  const input: Array<Array<Pick<FeedRoutePoint, 'lat' | 'lon'>>> = [];
  (segments ?? []).forEach((segment) => {
    if (Array.isArray(segment) && segment.length) {
      input.push(segment.filter((p) => isFiniteNumber(p.lat) && isFiniteNumber(p.lon)));
    }
  });
  const all = input.flat();
  if (!all.length) return null;

  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of all) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }

  const meanLatRad = (((south + north) / 2) * Math.PI) / 180;
  const cosMeanLat = Math.max(0.01, Math.cos(meanLatRad));
  const spanX = (east - west) * cosMeanLat;
  const spanY = north - south;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);

  const scale =
    spanX > 0 || spanY > 0
      ? Math.min(
          spanX > 0 ? usableWidth / spanX : Infinity,
          spanY > 0 ? usableHeight / spanY : Infinity,
        )
      : 1;
  // A perfectly vertical/horizontal route has no extent on one axis; centre it.
  const offsetX = padding + (usableWidth - spanX * scale) / 2;
  const offsetY = padding + (usableHeight - spanY * scale) / 2;

  let runningIndex = 0;
  const projectedSegments: ProjectedRouteSegment[] = input.map(
    (segment, segmentIndex) => {
      const points: ProjectedRoutePoint[] = segment.map((point) => ({
        x: round2(offsetX + (point.lon - west) * cosMeanLat * scale),
        y: round2(offsetY + (north - point.lat) * scale),
        index: runningIndex++,
      }));
      const d = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ');
      return { segmentIndex, points, d };
    },
  );

  return { width, height, segments: projectedSegments };
}
