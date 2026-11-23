// Terrain elevation for the community route viewer.
//
// ⚠️ WHY THIS EXISTS: a GPX `<ele>` is only as good as the device that wrote
// it. A planned/synthetic GPX can disagree with the map badly (the Central Park
// sample says 15 m at a point where MapTiler terrain is ~27 m). The operator
// chose terrain as the authoritative profile, so the viewer asks MapTiler's
// Elevation API for up to 50 samples along the route and interpolates those
// onto the dense display points. The GPX elevation remains the fallback when
// the API/key/host is unavailable.
//
// This is client-side on purpose: the MapTiler key is the existing public
// browser key, and the Elevation API allows up to 50 `lng,lat` positions per
// request. No raw GPX or coordinates are stored by this module.

import type { FeedRoutePoint } from './community-api';
import { flattenRoute } from './feed-route';

export interface TerrainSample {
  lat: number;
  lon: number;
  /** Cumulative distance along the route, metres. */
  distM: number;
}

export interface TerrainElevationStats {
  ascentM: number | null;
  descentM: number | null;
  minElevationM: number | null;
  maxElevationM: number | null;
}

/** MapTiler's Elevation API accepts at most 50 positions per request. */
export const TERRAIN_MAX_SAMPLES = 50;

/**
 * Pick up to 50 points spanning the whole route by distance. The first and
 * last points are always included, so the profile cannot start/end somewhere
 * other than the actual route.
 */
export function sampleRouteForTerrain(
  segments: ReadonlyArray<ReadonlyArray<FeedRoutePoint>> | null | undefined,
  maxSamples: number = TERRAIN_MAX_SAMPLES,
): TerrainSample[] {
  const flat = flattenRoute({
    segments: (segments ?? []) as FeedRoutePoint[][],
  });
  if (!flat.length) return [];
  const count = Math.max(1, Math.min(TERRAIN_MAX_SAMPLES, Math.floor(maxSamples), flat.length));
  if (count === 1) {
    return [{ lat: flat[0].lat, lon: flat[0].lon, distM: flat[0].distM }];
  }
  const step = (flat.length - 1) / (count - 1);
  const out: TerrainSample[] = [];
  let lastIndex = -1;
  for (let i = 0; i < count; i += 1) {
    const index = Math.min(flat.length - 1, Math.round(i * step));
    if (index === lastIndex) continue;
    lastIndex = index;
    out.push({ lat: flat[index].lat, lon: flat[index].lon, distM: flat[index].distM });
  }
  return out;
}

/**
 * Ask MapTiler for the ground elevation at each sample. Returns null — never a
 * partial/garbage array — so the caller can fall back to the GPX profile.
 * The key is never put in an error message or a log.
 */
export async function fetchTerrainElevations(
  samples: ReadonlyArray<TerrainSample>,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[] | null> {
  if (!samples.length || !key) return null;
  const requested = samples.slice(0, TERRAIN_MAX_SAMPLES);
  const locations = requested
    .map((sample) => `${sample.lon},${sample.lat}`)
    .join(';');
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.maptiler.com/elevation/${locations}.json?key=${encodeURIComponent(key)}`,
      { cache: 'no-store' },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(payload) || payload.length !== requested.length) return null;
  const elevations: number[] = [];
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 3) return null;
    const value = Number(row[2]);
    if (!Number.isFinite(value)) return null;
    elevations.push(value);
  }
  return elevations;
}

/** Interpolate the sampled terrain elevation at a cumulative distance. */
export function terrainElevationAt(
  samples: ReadonlyArray<TerrainSample>,
  elevations: ReadonlyArray<number>,
  distM: number,
): number | null {
  if (!samples.length || samples.length !== elevations.length) return null;
  if (distM <= samples[0].distM) {
    return Number.isFinite(elevations[0]) ? elevations[0] : null;
  }
  const last = samples.length - 1;
  if (distM >= samples[last].distM) {
    return Number.isFinite(elevations[last]) ? elevations[last] : null;
  }
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].distM >= distM) {
      const before = samples[i - 1];
      const after = samples[i];
      const span = after.distM - before.distM;
      if (!(span > 0)) return Number.isFinite(elevations[i]) ? elevations[i] : null;
      const t = (distM - before.distM) / span;
      return elevations[i - 1] + (elevations[i] - elevations[i - 1]) * t;
    }
  }
  return Number.isFinite(elevations[last]) ? elevations[last] : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Centred gradient window in dense points (~10 m at the display spacing). */
const GRADIENT_WINDOW = 2;
const MAX_GRADIENT_PCT = 100;

/**
 * Replace each display point's `ele` with the interpolated terrain elevation
 * and recompute the gradient from that terrain. Speed, coordinates and
 * cumulative distance are untouched.
 */
export function applyTerrainElevations(
  segments: ReadonlyArray<ReadonlyArray<FeedRoutePoint>>,
  samples: ReadonlyArray<TerrainSample>,
  elevations: ReadonlyArray<number>,
): FeedRoutePoint[][] {
  if (!segments.length || !samples.length || samples.length !== elevations.length) {
    return [];
  }
  return segments.map((segment) =>
    segment.map((point, index) => {
      const ele = terrainElevationAt(samples, elevations, point.distM);
      let gradientPct: number | null = null;
      if (ele !== null) {
        const first = Math.max(0, index - GRADIENT_WINDOW);
        const last = Math.min(segment.length - 1, index + GRADIENT_WINDOW);
        const before = terrainElevationAt(samples, elevations, segment[first].distM);
        const after = terrainElevationAt(samples, elevations, segment[last].distM);
        const run = segment[last].distM - segment[first].distM;
        if (before !== null && after !== null && run >= 0.5) {
          gradientPct = round1(
            Math.max(
              -MAX_GRADIENT_PCT,
              Math.min(MAX_GRADIENT_PCT, ((after - before) / run) * 100),
            ),
          );
        }
      }
      return {
        ...point,
        ele: ele === null ? null : round1(ele),
        gradientPct,
      };
    }),
  );
}

/** Terrain ascent/descent/min/max from a display series (2 m noise threshold). */
export function terrainElevationStats(
  segments: ReadonlyArray<ReadonlyArray<FeedRoutePoint>>,
): TerrainElevationStats {
  let ascent = 0;
  let descent = 0;
  let min = Infinity;
  let max = -Infinity;
  let has = false;
  for (const segment of segments) {
    let last: number | null = null;
    for (const point of segment) {
      if (point.ele === null || !Number.isFinite(point.ele)) continue;
      has = true;
      if (point.ele < min) min = point.ele;
      if (point.ele > max) max = point.ele;
      if (last === null) {
        last = point.ele;
        continue;
      }
      const change = point.ele - last;
      if (change >= 2) {
        ascent += change;
        last = point.ele;
      } else if (change <= -2) {
        descent += -change;
        last = point.ele;
      }
    }
  }
  if (!has) {
    return { ascentM: null, descentM: null, minElevationM: null, maxElevationM: null };
  }
  return {
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    minElevationM: Math.round(min),
    maxElevationM: Math.round(max),
  };
}
