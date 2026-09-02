/**
 * THE BENCH — the public shapes, and the one rule that governs them.
 *
 * ⚠️ NOTHING THAT NAMES A MANUAL EVER LEAVES THIS SERVICE. The consolidated
 * loads are derived from published reloading manuals, and which manual a
 * charge came from — its name, its page, its per-row start and max — is the
 * manuals' content, not ours. `BenchSourceLoad` is internal for that reason,
 * `sourcesCount` is never serialised, and bench.leak.spec.ts asserts that no
 * public response contains the strings `source`, `manual`, `page`, `CIP`,
 * `SAAMI` or `published`.
 *
 * The consolidated row is the thing we may publish: the lowest start and the
 * highest max across every manual that lists a combination, which is a fact
 * about the combination rather than a reproduction of anyone's table.
 */

/** A flag the client renders as a mono tag beside a COAL. */
export type CoalFlag = 'COAL_OVER_MAX' | 'COAL_NEAR_MAX' | 'COAL_RANGE';

export interface PublicLoadRow {
  id: string;
  bulletMaker: string;
  bulletType: string;
  powder: string;
  startGr: number;
  startFps: number | null;
  maxGr: number;
  maxFps: number | null;
  coalMm: number | null;
  coalLoMm: number | null;
  coalHiMm: number | null;
  flags: CoalFlag[];
}

export interface PublicWeightGroup {
  weightGr: number;
  rows: PublicLoadRow[];
}

export interface PublicCartridgeHead {
  key: string;
  name: string;
  maxLengthMm: number | null;
  pmaxBar: number | null;
  pmaxPsi: number | null;
  /** The dimensions subset the silhouette is drawn from. */
  thumb: Record<string, number | null> | null;
}

export interface PublicLoadGroup {
  cartridge: PublicCartridgeHead;
  weights: PublicWeightGroup[];
}

export interface LoadsResponse {
  count: number;
  groups: PublicLoadGroup[];
}

export interface BenchPowderView {
  id: string;
  name: string;
  maker: string | null;
  /** How many consolidated loads this powder unlocks for the caller's bench. */
  loadsForBench?: number;
}

export interface BenchBulletView {
  maker: string;
  weightGr: number;
  category: string;
  type?: string;
}

export interface BenchView {
  powders: BenchPowderView[];
  bullets: BenchBulletView[];
  cartridges: { key: string; name: string }[];
  units: string;
}

/**
 * How close a COAL may sit to the cartridge's maximum before it is called out.
 *
 * ⚠️ HALF A MILLIMETRE, AND IT IS A WARNING RATHER THAN A FILTER. A published
 * COAL within 0.5 mm of L6 is not wrong — it is a load the reloader has to
 * measure their own chamber against rather than trust. Hiding those rows
 * would be worse than flagging them: the reloader would find the same load in
 * the manual and load it with no warning at all.
 */
export const COAL_NEAR_MAX_MM = 0.5;

/**
 * Flags for one consolidated row against its cartridge's L6 ceiling.
 *
 * ⚠️ COMPUTED SERVER-SIDE, ALWAYS. The client renders flags; it never derives
 * them. A COAL comparison done in the browser is one a stale bundle can get
 * wrong, and this particular comparison is the one standing between a
 * reloader and a round that will not chamber.
 */
export function coalFlags(
  row: { coalMm: number | null; coalLoMm: number | null; coalHiMm: number | null },
  maxLengthMm: number | null,
): CoalFlag[] {
  const flags: CoalFlag[] = [];
  if (row.coalLoMm !== null && row.coalHiMm !== null) flags.push('COAL_RANGE');
  if (maxLengthMm === null) return flags;

  // The upper end of the range is what has to fit, so a spanning group is
  // judged on coalHiMm rather than on the representative COAL.
  const effective = row.coalHiMm ?? row.coalMm;
  if (effective === null) return flags;

  if (effective > maxLengthMm) flags.push('COAL_OVER_MAX');
  else if (maxLengthMm - effective <= COAL_NEAR_MAX_MM) flags.push('COAL_NEAR_MAX');
  return flags;
}

/**
 * The dimensions the cartridge silhouette is drawn from.
 *
 * A deliberate subset: enough to draw a recognisable case profile, and not the
 * chamber figures, which belong on the spec card where they carry their
 * tolerances and footnotes.
 */
export const THUMB_DIM_FIELDS = ['R', 'E', 'P1', 'P2', 'H1', 'H2', 'L1', 'L3', 'L6'] as const;
