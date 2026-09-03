/**
 * THE BENCH — which bullets a load may be offered for.
 *
 * 🚨 THE MAKER AND THE TYPE ARE NOT PART OF THE MATCH, AND THAT IS THE POINT OF
 * THE TOOL. Operator, 2026-09-03: "a 150gr bullet of any manufacturer would
 * yield almost the exact same pressures and speeds. this is the whole point of
 * the Bench."
 *
 * The first model matched a bench bullet on maker + weight + category, which is
 * how the SOURCE data is shaped rather than how a reloader thinks. It made the
 * tool nearly useless: a bench holding .30-06, N550 and a Hornady 150gr SP
 * returned NOTHING, because the loads that exist for .30-06 with N550 at 150
 * grains are a Barnes, a Sierra, a Lapua, a Norma and a Hornady TIP. The member
 * owns a 150 grain bullet. Every one of those loads is useful to them.
 *
 * So the bullet axis matches on WEIGHT, within a tolerance, and on the calibre
 * the cartridge implies — never on whose name is on the box.
 *
 * ⚠️ THE CALIBRE STILL BINDS. Dropping the maker does not mean dropping the
 * diameter: a 150gr .277 and a 150gr .308 are different bullets, and offering
 * one for the other is the hazard the calibre work exists to prevent. See
 * bullet-calibre.ts.
 */

/**
 * How far either side of a stated bullet weight still counts as that bullet.
 *
 * ⚠️ FIVE GRAINS IS INHERITED, NOT INVENTED. The retired Load Lab's
 * recommend(cartridge, bulletWeightGr, toleranceGr = 5) used the same figure,
 * and the reloading-manual search auto-broadens by ±5 grains for the same
 * reason. Keeping it means a member who used the old tool sees the same breadth
 * in this one.
 *
 * On a real bench — .30-06 with N550 at 150 grains — exact weight finds 9
 * loads and ±5 finds 17. The wider set is the useful one: 145 to 155 grains in
 * a .30 calibre is one shelf of bullets to a reloader.
 *
 * ⚠️ IT IS A SEARCH WIDTH, NOT A SAFETY MARGIN. Every load returned is still
 * quoted at ITS OWN bullet weight, with its own start and max charge. Nothing
 * here says a charge for a 145gr bullet may be used with a 155gr one — the
 * member picks the load whose bullet they actually have, and each load card
 * names its own.
 */
export const DEFAULT_WEIGHT_TOLERANCE_GR = 5;

/** The widths the finder offers. 0 means the stated weight only. */
export const WEIGHT_TOLERANCES_GR = [0, 5, 10, 15] as const;

export type WeightToleranceGr = (typeof WEIGHT_TOLERANCES_GR)[number];

/**
 * Clamp an arbitrary tolerance to one the finder offers.
 *
 * ⚠️ A QUERY STRING IS A STRANGER. An unbounded tolerance from the URL would
 * let one request ask for every bullet weight in the catalogue, and a negative
 * one would invert the range into a window that matches nothing.
 */
export function resolveTolerance(raw: unknown): WeightToleranceGr {
  // ⚠️ Number('') IS 0, NOT NaN. An empty ?tolerance= in the URL would fall
  // through as a real zero and silently narrow the search to the exact weight
  // — the precise narrowness this tolerance exists to undo. Blank is absent.
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  if (trimmed === '' || trimmed === null || trimmed === undefined) {
    return DEFAULT_WEIGHT_TOLERANCE_GR;
  }
  const n = typeof trimmed === 'string' ? Number(trimmed) : typeof trimmed === 'number' ? trimmed : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_WEIGHT_TOLERANCE_GR;
  let best: WeightToleranceGr = WEIGHT_TOLERANCES_GR[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const t of WEIGHT_TOLERANCES_GR) {
    const gap = Math.abs(t - n);
    if (gap < bestGap) {
      bestGap = gap;
      best = t;
    }
  }
  return best;
}

/**
 * The inclusive grain window a bench bullet matches over.
 *
 * Inclusive at both ends: a member who says 150 with a tolerance of 5 means
 * 145 and 155 are in, and a half-open window would silently drop the heaviest
 * bullet they asked for.
 */
export function weightWindow(
  weightGr: number,
  toleranceGr: number = DEFAULT_WEIGHT_TOLERANCE_GR,
): { gte: number; lte: number } {
  const t = Math.max(0, toleranceGr);
  return { gte: weightGr - t, lte: weightGr + t };
}
