/**
 * SA Biomes — curated reference data for the AI range estimator.
 *
 * Each biome entry includes:
 * - A coarse polygon boundary (SANBI biome map, simplified to ~50-200
 *   vertices for fast point-in-polygon testing)
 * - 15-20 characteristic reference plants with typical heights spanning
 *   ground cover, low shrubs, mid-canopy, and mature trees
 *
 * Source references:
 * - SANBI Biomes & Bioregions of South Africa (2018 revision)
 * - Trees of Southern Africa — Braam van Wyk & Piet van Wyk
 * - Field Guide to Trees of Southern Africa — Schmidt, Lötter & McCleland
 * - Mucina & Rutherford 2006: Vegetation of South Africa, Lesotho &
 *   Swaziland (the authoritative classification we follow)
 *
 * Plant heights are TYPICAL ranges, not extremes — the AI uses them as
 * reference scale, so the median height of mature specimens is the
 * useful number. "Knobthorn 5-12 m" means most adult knobthorns in the
 * Bushveld fall in that band; use it as a ruler.
 *
 * Coverage: 9 SANBI biomes. The "Savanna" biome is split into Bushveld
 * + Lowveld because they have notably different vegetation profiles
 * (knobthorn-dominated thornveld vs mopane-dominated lowveld) despite
 * sharing the savanna classification, and SA hunters work in both
 * with different practical considerations.
 *
 * NOTE: This file is populated in W2. W1 ships an empty array so the
 * skeleton compiles — BiomeLookupService returns null for every
 * coordinate until the W2 data lands.
 */

/** Where in the vertical profile a plant sits — used to tell the AI
 *  "look low / mid / high" when anchoring scale. */
export type PlantLayer = 'ground' | 'shrub' | 'mid-canopy' | 'tree';

export type PlantReference = {
  /** Scientific binomial, e.g. "Senegalia nigrescens". Most precise
   *  identifier; survives common-name disagreements between regions. */
  scientific: string;
  /** English common name, e.g. "Knobthorn". */
  english: string;
  /** Afrikaans common name, e.g. "Knoppiesdoring". */
  afrikaans: string;
  /** Typical height range in metres for mature specimens. */
  heightM: { min: number; max: number };
  /** Optional canopy diameter for mature specimens (metres). Useful
   *  when the AI sees a top-down or side-on tree as a width reference. */
  canopyM?: { min: number; max: number };
  /** Vertical layer this plant occupies. */
  layer: PlantLayer;
  /** Optional one-line description ("evergreen", "umbrella crown",
   *  "thorny", "blooms yellow Oct-Nov") — surfaced to the AI so it can
   *  distinguish similar-looking species and pick the right reference. */
  notes?: string;
};

export type BiomeProfile = {
  /** Stable identifier — used in logs and persisted in RangeEstimate
   *  rows so we can later correlate accuracy with biome. */
  id: string;
  /** Human-readable name, e.g. "Bushveld (Limpopo savanna)". */
  name: string;
  /** Short description injected into the AI's system prompt — what
   *  the biome looks like at a glance and how to use it as context. */
  description: string;
  /** Reference plants — 15-20 entries, mix of vertical layers. */
  plants: PlantReference[];
  /** Polygon boundary as a closed ring of [lat, lng] pairs. SANBI
   *  biomes simplified to ~50-200 vertices each. */
  boundary: ReadonlyArray<readonly [number, number]>;
};

/**
 * The 9 SANBI biomes (Savanna split into Bushveld + Lowveld) covering
 * South Africa. Populated in W2 — empty placeholder in W1 so the
 * skeleton compiles.
 */
export const SA_BIOMES: ReadonlyArray<BiomeProfile> = [];
