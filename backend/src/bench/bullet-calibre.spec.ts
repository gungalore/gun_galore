import {
  calibreFromG1,
  formatCalibre,
  MM_PER_INCH,
  CIP_MAX_ALLOWANCE_IN,
  STANDARD_DIAMETERS_IN,
} from './bullet-calibre';

/**
 * 🚨 THE FAILURE THIS GUARDS AGAINST IS A BULLET THAT DOES NOT FIT.
 *
 * Every figure below is the real C.I.P. G1 from the sheet we hold for that
 * cartridge. The test is not "does the arithmetic work" — it is "are two
 * cartridges that take the same bullet grouped together, and are two that do
 * not kept apart".
 */

/** G1 in millimetres, straight off the sheets. */
const G1 = {
  creedmoor65: 6.72,
  win270: 7.06,
  win308: 7.85,
  hh300: 7.82,
  lapua300: 7.87,
  british303: 7.92,
  x39_762: 7.92,
  is8x57: 8.22,
  rem32: 8.16,
  rem223: 5.69,
  lapua338: 8.61,
};

const cal = (mm: number) => calibreFromG1(mm);

describe('calibreFromG1 — cartridges that share a bullet', () => {
  it('groups .308 Win, .300 H&H and .300 Lapua as one .308 bullet', () => {
    // Their C.I.P. maxima differ by a thou (0.309 / 0.308 / 0.310) and all
    // three take the same projectile.
    expect(cal(G1.win308)).toBe(0.308);
    expect(cal(G1.hh300)).toBe(0.308);
    expect(cal(G1.lapua300)).toBe(0.308);
  });

  it('groups .303 British with 7.62x39', () => {
    expect(cal(G1.british303)).toBe(cal(G1.x39_762));
  });
});

describe('calibreFromG1 — cartridges that must NOT be merged', () => {
  it('keeps .270 apart from .308', () => {
    // The case that started this: one "150gr SP" spanned both.
    expect(cal(G1.win270)).not.toBe(cal(G1.win308));
    expect(cal(G1.win270)).toBe(0.277);
  });

  it('keeps .308 apart from .311', () => {
    // Three thou apart. A .311 down a .308 bore is a pressure problem.
    expect(cal(G1.win308)).toBe(0.308);
    expect(cal(G1.british303)).toBe(0.311);
    expect(cal(G1.win308)).not.toBe(cal(G1.british303));
  });

  it('keeps .32 Rem apart from 8x57, two thou apart', () => {
    // ⚠️ THE CASE THAT RULES OUT TOLERANCE CHAINING. The gap between these
    // two calibres is the same size as the spread WITHIN the .308 family, so
    // any rule that chains neighbours merges them.
    expect(cal(G1.rem32)).not.toBe(cal(G1.is8x57));
  });

  it('places every distinct calibre on its own value', () => {
    const distinct = new Set([
      cal(G1.rem223), cal(G1.creedmoor65), cal(G1.win270),
      cal(G1.win308), cal(G1.british303), cal(G1.is8x57), cal(G1.lapua338),
    ]);
    expect(distinct.size).toBe(7);
  });
});

describe('calibreFromG1 — the fallback', () => {
  it('keeps its own figure rather than forcing a wrong snap', () => {
    // 6.5x52 Carcano is genuinely .268, not the .264 of every other 6.5.
    // Nothing on the standard list is close, so it stays where it measured
    // and lands in a group of its own. Too granular is the safe direction.
    const carcano = calibreFromG1(0.2677 * MM_PER_INCH + 0.001 * MM_PER_INCH);
    expect(carcano).not.toBe(0.264);
  });

  it('returns null when the cartridge has no sheet', () => {
    expect(calibreFromG1(null)).toBeNull();
    expect(calibreFromG1(undefined)).toBeNull();
    expect(calibreFromG1(0)).toBeNull();
    expect(calibreFromG1(Number.NaN)).toBeNull();
  });

  /**
   * ⚠️ THE FALLBACK IS A THOU, AND THE THOU IS NOT A TOLERANCE. Bullets are
   * sold at thou resolution, so two sheets that agree to a thou are the same
   * projectile — but the figure must never reach ACROSS to a standard
   * diameter, because that is a merge decided by rounding rather than by the
   * snap. It cannot: anything within half a thou of a standard has already
   * snapped to it.
   */
  it('keeps its own figure to the thou, and never rounds onto a standard', () => {
    const mm = (inches: number) => (inches + 0.001) * MM_PER_INCH;
    // .3177 and .3181 are the same bullet and land together …
    expect(calibreFromG1(mm(0.3177))).toBe(0.318);
    expect(calibreFromG1(mm(0.3181))).toBe(0.318);
    // … and .318 is not on the standard list, so nothing was forced onto one.
    expect(STANDARD_DIAMETERS_IN).not.toContain(0.318);
    // The neighbours it must not have reached: 8x57 J (.318) against the
    // 8x57 IS (.323) and the .315 above it.
    expect(calibreFromG1(mm(0.3177))).not.toBe(0.315);
    expect(calibreFromG1(mm(0.3177))).not.toBe(0.323);
  });
});

/**
 * 🚨 THE BOUNDARIES THE SNAP IS ONLY SAFE INSIDE. Nothing in the function can
 * check these — they are facts about the standard list and about how far a
 * C.I.P. maximum sits above a nominal — so they are pinned here, where moving
 * the window, the allowance or the list fails loudly.
 */
describe('calibreFromG1 — the snap boundaries', () => {
  /**
   * The G1 a sheet publishes for a bullet of `nominalIn`, printed `allowanceIn`
   * over it. The default is the allowance the model assumes, so `sheet(x)` is
   * the input that puts the figure under test exactly at x.
   */
  const sheet = (nominalIn: number, allowanceIn = CIP_MAX_ALLOWANCE_IN) =>
    (nominalIn + allowanceIn) * MM_PER_INCH;

  /**
   * 🚨 A SHEET IS PRINTED TO A HUNDREDTH OF A MILLIMETRE, SO THE TRUE
   * DIAMETER IS ANYWHERE WITHIN HALF A STEP OF IT. A classification that
   * flips inside that step is luck rather than a reading — and it flipped:
   * with a full thou taken off, .223 Rem beat .222" by 0.00003", so half a
   * printed step the other way turned every .224" bullet in the catalogue
   * into a 5.45x39's .222".
   *
   * The property is not "the answer never moves" — a nudge may push a
   * cartridge out of the snap window into a group of its own, which is the
   * safe direction, and .311"/.312" are the same projectile. It is that a
   * nudge never lands it on a DIFFERENT bullet.
   */
  it('does not change bullet when the sheet is read half a printed step either way', () => {
    const standards = new Set<number>(STANDARD_DIAMETERS_IN);
    for (const [name, g1] of Object.entries(G1)) {
      const truth = calibreFromG1(g1) as number;
      for (const nudge of [-0.005, 0.005]) {
        const nudged = calibreFromG1(g1 + nudge) as number;
        const merged = standards.has(nudged) && Math.abs(nudged - truth) >= 0.002;
        expect({ name, nudge, landedOn: merged ? nudged : truth }).toEqual({
          name,
          nudge,
          landedOn: truth,
        });
      }
    }
  });

  it('lands on the nearer standard, and on neither when it is a dead heat', () => {
    // Either side of a midpoint goes where it should …
    expect(calibreFromG1(sheet(0.3112))).toBe(0.311);
    expect(calibreFromG1(sheet(0.3118))).toBe(0.312);
    expect(calibreFromG1(sheet(0.3212))).toBe(0.321);
    expect(calibreFromG1(sheet(0.3228))).toBe(0.323);

    // … and a figure exactly between two standards snaps to NEITHER. Picking
    // one on list order is how every 8mm's .323" bullet ended up in the .32
    // Rem's .321" group; keeping the measured figure puts it in a group of its
    // own, which costs a member an extra row instead of a load that does not
    // chamber.
    const deadHeat = sheet(0.322);
    expect(calibreFromG1(deadHeat)).not.toBe(0.321);
    expect(calibreFromG1(deadHeat)).not.toBe(0.323);
    expect(calibreFromG1(deadHeat)).toBe(0.322);
    // Deterministic, not random: the same sheet answers the same way on every
    // page load, or one bullet splits across two rows between openings.
    expect(calibreFromG1(deadHeat)).toBe(calibreFromG1(deadHeat));
  });

  /**
   * 🚨 THE MERGE THIS CAUGHT WAS REAL. These four pairs are two thou apart and
   * are DIFFERENT bullets, and the figure they are judged on is a C.I.P.
   * maximum less a FIXED 1-thou allowance while the real allowance runs 0–2
   * thou (.300 H&H publishes 0.308" for a .308" bullet — no allowance at all;
   * .300 Lapua publishes 0.310" — two). At the no-allowance end the upper
   * member landed exactly on the midpoint and list order handed it to the
   * LOWER one: every .323" 8mm into the .321" .32 Rem, every .224" into the
   * .222", every .429" into the .427".
   *
   * It is the allowance drifting, not the diameter, that walks a cartridge
   * over the line — so each pair is checked across the whole range the sheets
   * show, and the assertion is the one that matters: never the neighbour's.
   */
  it('never hands a two-thou pair to the wrong neighbour, whatever the allowance', () => {
    const pairs = [
      [0.321, 0.323], // .32 Rem against 8mm — the pair that rules out chaining
      [0.355, 0.357], // 9 mm against .38/.357
      [0.427, 0.429], // .44-40 against .44 Magnum
      [0.222, 0.224], // 5.45x39 against the .224 every other .22 centrefire runs
    ];

    for (const [lower, upper] of pairs) {
      // ⚠️ 0 TO 1 THOU IS THE RANGE THE SHEETS ACTUALLY SHOW ON THESE PAIRS
      // (.223 Rem 0.0000, .32 Rem 0.0003, 8x57 0.0006), and the model is only
      // claimed to hold across it. A sheet printed more than 1.5 thou over its
      // bullet would cross the midpoint and merge upward — the one such sheet
      // we hold is .300 Lapua at 1.8, whose neighbours are three thou away.
      // A new sheet on one of THESE pairs at that allowance is the residual
      // risk, and it is why these figures are pinned rather than assumed.
      for (const allowance of [0, 0.0005, 0.001]) {
        expect(calibreFromG1(sheet(lower, allowance))).not.toBe(upper);
        expect(calibreFromG1(sheet(upper, allowance))).not.toBe(lower);
      }
      // And with the allowance the model assumes, each still lands on itself
      // rather than retreating to a group of its own for no reason.
      expect(calibreFromG1(sheet(lower))).toBe(lower);
      expect(calibreFromG1(sheet(upper))).toBe(upper);
    }
  });
});

describe('formatCalibre', () => {
  it('writes a calibre the way it appears on a box of bullets', () => {
    expect(formatCalibre(0.308)).toBe('.308"');
    expect(formatCalibre(0.277)).toBe('.277"');
    expect(formatCalibre(0.224)).toBe('.224"');
  });

  it('renders nothing when there is no figure, rather than a bare quote', () => {
    expect(formatCalibre(null)).toBe('');
  });
});
