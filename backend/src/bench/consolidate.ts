/**
 * THE BENCH — consolidation.
 *
 * Several manuals publish the same combination — same cartridge, same bullet
 * maker, same weight, same category, same powder — with different charge
 * ranges, because they tested in different barrels with different lots. The
 * Bench shows one row per combination.
 *
 * ⚠️ THE WIDEST SAFE-PUBLISHED WINDOW, NOT AN AVERAGE. The start is the
 * LOWEST start any manual gives and the max is the HIGHEST max any manual
 * gives. Averaging would invent a number no manual printed and no one tested;
 * narrowing to a single manual would hide a start charge somebody's load
 * actually needs. The window is the union of what has been published.
 *
 * ⚠️ EACH VELOCITY TRAVELS WITH ITS OWN CHARGE. The fps beside the lowest
 * start is the fps that manual measured AT that start, and likewise for the
 * max. Taking the lowest charge from one row and a velocity from another
 * would print a pairing nobody ever chronographed — which is exactly the kind
 * of number a reloader would work backwards from.
 *
 * This is the one piece of Bench logic where being wrong is a safety problem
 * rather than a display problem, which is why it lives here as a pure
 * function with its own tests instead of inline in the import script.
 */

export interface ConsolidationInput {
  startGr: number;
  startFps: number | null;
  maxGr: number;
  maxFps: number | null;
  coalMm: number | null;
  bulletType: string;
}

export interface ConsolidationResult {
  startGr: number;
  startFps: number | null;
  maxGr: number;
  maxFps: number | null;
  coalMm: number | null;
  coalLoMm: number | null;
  coalHiMm: number | null;
  bulletType: string;
  sourcesCount: number;
}

/** Above this spread, the group's COALs are reported as a range. */
export const COAL_SPREAD_MM = 0.5;

export function mostCommon<T>(values: T[]): T | null {
  const freq = new Map<T, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of freq) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export function consolidate(rows: ConsolidationInput[]): ConsolidationResult {
  if (rows.length === 0) throw new Error('consolidate() needs at least one row');

  // reduce keeps the FIRST row on a tie, so a stable input gives a stable
  // output — a re-import must not reshuffle which velocity is shown.
  const lowest = rows.reduce((a, b) => (b.startGr < a.startGr ? b : a));
  const highest = rows.reduce((a, b) => (b.maxGr > a.maxGr ? b : a));

  const coals = rows.map((r) => r.coalMm).filter((c): c is number => c !== null);
  const spread = coals.length ? Math.max(...coals) - Math.min(...coals) : 0;
  const ranged = spread > COAL_SPREAD_MM;

  // The COAL printed beside the highest max is the one that matters: it is
  // the seating depth the hottest published charge was tested at. Only when
  // that row has no COAL do we fall back to the group's most common.
  const coalMm = highest.coalMm ?? (coals.length ? mostCommon(coals) : null);

  return {
    startGr: lowest.startGr,
    startFps: lowest.startFps,
    maxGr: highest.maxGr,
    maxFps: highest.maxFps,
    coalMm,
    coalLoMm: ranged ? Math.min(...coals) : null,
    coalHiMm: ranged ? Math.max(...coals) : null,
    bulletType: mostCommon(rows.map((r) => r.bulletType)) ?? '',
    sourcesCount: rows.length,
  };
}

/**
 * Groups worth a human look before publishing.
 *
 * A window wider than 10% of its own start usually means two different
 * powders or two different bullets have been folded together by a name
 * collision — not that one combination genuinely spans that much.
 */
export function needsReview(result: ConsolidationResult): boolean {
  return result.maxGr - result.startGr > result.startGr * 0.1;
}
