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

/**
 * Why a search came back with nothing.
 *
 * ⚠️ AN EMPTY SCREEN IS INDISTINGUISHABLE FROM A BROKEN ONE WITHOUT THIS, AND
 * THAT IS EXACTLY HOW IT WAS REPORTED: "I choose a cartridge and a bullet and
 * nothing comes up." The results are an AND across powder, bullet and
 * cartridge, so ONE starving axis empties the page while the other two are
 * full — a bench holding N550, .30-06 and a 150 gr Hornady SP has 70 .30-06
 * loads on that powder and 13 on that bullet, and none that are both. The
 * screen was right and said nothing, which reads as the screen being broken.
 *
 * Each figure is the same query with ONE axis relaxed:
 *
 *   ignoringBullets    — this bench's cartridges and powders, any bullet
 *   ignoringPowders    — this bench's cartridges and bullets, any powder
 *   ignoringCartridges — this bench's powders and bullets, any cartridge
 *
 * Read together they name the axis to change: the one whose removal finds
 * loads is the one that is starving.
 *
 * ⚠️ THESE ARE LOAD COUNTS AND NOTHING ELSE. How many consolidated loads a
 * combination has is a fact about the combination — the same fact the picker
 * chips already publish. A count of what those loads were derived from is a
 * different fact and never travels; bench.leak.spec.ts is the boundary.
 *
 * Present ONLY when count is 0 AND the bench holds all three axes. With an
 * axis bare the answer is already known — the client says "add a bullet"
 * rather than "no combination exists" — and three more counts would be spent
 * to learn nothing.
 */
export interface LoadsWhy {
  ignoringBullets: number;
  ignoringPowders: number;
  ignoringCartridges: number;
}

export interface LoadsResponse {
  count: number;
  groups: PublicLoadGroup[];
  /** See LoadsWhy — absent unless the answer was empty and the bench was full. */
  why?: LoadsWhy;
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
  /**
   * Inches, from the cartridge's C.I.P. G1 — see bullet-calibre.ts.
   *
   * 🚨 A WEIGHT IS NOT A BULLET, AND THIS IS THE FIELD THAT SAYS WHICH ONE.
   * "Hornady 150gr SP" names a .277", a .308", a .311" and a .323" projectile
   * and they do not swap, so it travels with the bullet everywhere the bullet
   * goes — onto the chip, and back into loads() through the controller's
   * benchFor().
   *
   * ⚠️ DECLARED HERE OR IT IS INVISIBLE. UserBench.bullets is a Json column
   * that getBench() casts straight through, so the VALUE reaches the client
   * whether this line exists or not — but every server-side reader rebuilds a
   * bullet field by field off this type, and a field the type does not mention
   * is a field nobody copies. That is precisely how the calibre reached the
   * rail and never reached the results query.
   *
   * ⚠️ OPTIONAL, AND IT STAYS OPTIONAL. Benches saved before calibres were
   * recorded carry none; those bullets match any calibre, exactly as they did.
   */
  calibreIn?: number | null;
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
