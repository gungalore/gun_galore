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

/**
 * A flag on a LOGGED entry: the COAL flags plus where the charge sits in the
 * load's own window.
 *
 * 🚨 THE LOG SHEET WARNS AND THE LOG LIST DID NOT, WHICH IS THE WRONG WAY
 * ROUND. The sheet shows `ABOVE MAX 41.5` while the member types — and then
 * the entry lands in a list where a charge two grains over the maximum looks
 * like every other row. The one place a reloader goes back to read what they
 * did is the one place that said nothing about it.
 *
 * ⚠️ COMPUTED SERVER-SIDE, like the COAL flags and for the same reason: this
 * is the comparison standing between a reloader and an over-pressure round,
 * and a stale bundle must not be able to get it wrong.
 */
export type LogFlag = CoalFlag | 'ABOVE_MAX' | 'BELOW_START';

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
  /**
   * The listing hit LOADS_MAX and was cut.
   *
   * ⚠️ A CAP IS ONLY ALLOWED BECAUSE THIS FIELD EXISTS. The module's rule is
   * that nothing may be shortened silently while the browser does the
   * filtering — that is how five powders went unreachable — so the client MUST
   * say on screen that the list was cut and how to narrow it. `count` is the
   * number of rows RETURNED, not the number that matched: a count of the
   * whole match would need a second query to say something the member cannot
   * act on.
   */
  truncated?: boolean;
}

/**
 * One row of GET /bench/log.
 *
 * ⚠️ `startGr` / `maxGr` ARE THE LOAD'S WINDOW, NOT THE ENTRY'S. They are null
 * when the entry was typed free-hand (no `loadId`) or when the load it came
 * off has since been re-consolidated away — and null must render as "no window
 * known", never as 0, which would put every entry above its own maximum.
 */
export interface PublicLogEntry {
  id: string;
  cartridgeKey: string;
  cartridgeName: string;
  bulletLabel: string;
  powderName: string;
  chargeGr: number;
  coalMm: number | null;
  primer: string | null;
  caseLabel: string | null;
  loadId: string | null;
  velocityMs: number | null;
  groupMm: number | null;
  notes: string | null;
  shotAt: Date;
  createdAt: Date;
  /** The load's start charge, or null — see above. */
  startGr: number | null;
  /** The load's max charge, or null — see above. */
  maxGr: number | null;
  flags: LogFlag[];
}

export interface BenchPowderView {
  id: string;
  name: string;
  maker: string | null;
  /** How many consolidated loads this powder unlocks for the caller's bench. */
  loadsForBench?: number;
}

/**
 * A bullet on a member's shelf: A WEIGHT IN A CALIBRE, and nothing else.
 *
 * 🚨 THE MAKER AND THE TYPE ARE NOT PART OF IT. Operator, 2026-09-03: "a 150gr
 * bullet of any manufacturer would yield almost the exact same pressures and
 * speeds. this is the whole point of the Bench." They are kept below as
 * decoration off older benches — nothing of a member's is thrown away — but no
 * query narrows on them. See bullet-weight.ts.
 */
export interface BenchBulletView {
  weightGr: number;
  /**
   * Inches, from the cartridge's C.I.P. G1 — see bullet-calibre.ts.
   *
   * 🚨 DROPPING THE MAKER DOES NOT DROP THE DIAMETER. A 150 gr .277 and a
   * 150 gr .308 are different bullets, and offering one for the other is the
   * hazard this field exists to prevent — so it travels with the bullet
   * everywhere the bullet goes: onto the chip, and back into loads() through
   * the controller's benchFor().
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
  /**
   * ⚠️ LEGACY DECORATION, READ BY NOTHING THAT MATCHES. Benches saved under
   * the maker+weight+category model carry these, and they are kept so a
   * member's shelf survives the change — but a query that narrowed on one
   * would put the old model back. Mirrors BenchBullet in lib/bench/api.ts.
   */
  maker?: string;
  category?: string;
  type?: string;
}

/**
 * A bullet's identity, in one string: calibre then weight.
 *
 * 🚨 THE SAME SPELLING AS bulletKey() IN components/bench/contract.ts, AND IT
 * HAS TO STAY THAT WAY. The client sends these strings back as `off` — the
 * chips switched off for one search — and a key that disagrees by so much as
 * an empty part does not error: it leaves the chip greyed on the screen and
 * live in the query. Declared here, imported by the controller and by
 * getBench()'s de-duplication, so there is one spelling on this side too.
 *
 * ⚠️ THE STORED VALUE, TEMPLATED, NOT A PARSED ONE. GET /bench/me hands the
 * Json column back as written, so the client keyed on exactly this — and
 * rounding, re-parsing or normalising here would build a key it never sends.
 * A missing or null calibre writes an empty first part, which is what the
 * client writes for a bench saved before calibres were recorded.
 */
export function benchBulletKey(b: { weightGr: number; calibreIn?: number | null }): string {
  return `${b.calibreIn ?? ''}|${b.weightGr}`;
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
 * Flags for one LOGGED entry: its COAL against the cartridge's ceiling, and
 * its charge against the load's own start–max window.
 *
 * ⚠️ THE WINDOW IS THE LOAD'S, SO NO WINDOW MEANS NO CHARGE FLAG. An entry
 * typed without a load behind it has nothing to be above or below, and
 * inventing a comparison against the cartridge's other loads would flag a
 * perfectly worked-up charge as over maximum because a different bullet's is.
 *
 * ⚠️ AND THE COMPARISON IS THE SHEET'S, VERBATIM. LogSheet.tsx shows
 * `ABOVE MAX 41.5` on `chargeGr > row.maxGr` and `BELOW START 35.6` on
 * `chargeGr < row.startGr` while the member types. The same round must not
 * change its mind about itself once it is saved.
 */
export function logFlags(
  entry: { chargeGr: number; coalMm: number | null },
  window: { startGr: number; maxGr: number } | null,
  maxLengthMm: number | null,
): LogFlag[] {
  const flags: LogFlag[] = [
    // A logged COAL is one figure, never a spanning range, so lo/hi are null
    // and COAL_RANGE can never be raised here.
    ...coalFlags({ coalMm: entry.coalMm, coalLoMm: null, coalHiMm: null }, maxLengthMm),
  ];
  if (window) {
    if (entry.chargeGr > window.maxGr) flags.push('ABOVE_MAX');
    else if (entry.chargeGr < window.startGr) flags.push('BELOW_START');
  }
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
