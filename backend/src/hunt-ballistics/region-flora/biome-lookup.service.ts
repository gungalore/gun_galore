import { Injectable } from '@nestjs/common';
import { SA_BIOMES, type BiomeProfile } from './sa-biomes';

/**
 * BiomeLookupService — maps a GPS coordinate to the South African biome
 * containing it. Returns the regional plant profile used by the AI
 * range estimator as reference-scale anchors.
 *
 * Implementation: ray-casting point-in-polygon containment against
 * hand-digitised biome boundaries. ~1ms typical, no external network
 * calls, all data lives in sa-biomes.ts.
 *
 * Returns null for coordinates outside the curated coverage area. The
 * caller falls back to a generic system prompt without regional flora
 * (the AI still works, just without the regional ruler).
 */
@Injectable()
export class BiomeLookupService {
  /**
   * Look up the biome containing the given GPS coordinate.
   *
   * @param lat Decimal degrees, -90..90. SA is negative.
   * @param lng Decimal degrees, -180..180. SA is positive.
   * @returns Biome profile when the coordinate is inside a covered
   *          region, null otherwise (invalid input, out of bounds, or
   *          outside the SA + neighbours coverage envelope).
   */
  lookup(lat: number, lng: number): BiomeProfile | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    // SA biomes are non-overlapping at this resolution, so first-match
    // is correct. Iteration is short (~10 biomes × 1-2 polygons each)
    // so we don't bother with a spatial index.
    for (const biome of SA_BIOMES) {
      for (const polygon of biome.boundaries) {
        if (pointInPolygon(lat, lng, polygon)) {
          return biome;
        }
      }
    }
    return null;
  }
}

/**
 * Ray-casting point-in-polygon test. Polygon is a closed ring of
 * [lat, lng] pairs (last vertex need not duplicate the first).
 *
 * Good-enough for biome-scale lookups — these polygons are coarse
 * (50-200 vertices each), not GIS-precision geometries. We're not
 * drawing a legal boundary, just answering "is this point most likely
 * Bushveld or Karoo?".
 */
function pointInPolygon(
  lat: number,
  lng: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
