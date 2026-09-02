/**
 * THE BENCH — a cartridge's bullet diameter, and the calibre it belongs to.
 *
 * 🚨 THIS EXISTS BECAUSE A WEIGHT IS NOT A BULLET. "Hornady 150gr SP" names
 * four different projectiles: the .270 Win one is .277", the .308 Win one is
 * .308", the .303 British one is .311" and the 8x57 one is .323". They are not
 * interchangeable, and a bullet that is three thou over will not chamber — or
 * will chamber and spike pressure.
 *
 * Without a diameter, a member with .270 and .308 both on the bench and one
 * "150gr SP" entry is shown loads for both and told they can build them. That
 * is the whole reason the picker was ambiguous.
 *
 * The figure comes from C.I.P.'s own G1 — the MAXIMUM bullet diameter for the
 * cartridge — which the sheet parser stores per cartridge. G1 runs from ZERO
 * to about two thou over the nominal diameter a reloader buys, and how far
 * over is a property of the SHEET rather than of the bullet: .223 Rem reads
 * 0.224" for a .224" bullet, .308 Win reads 0.309", .300 H&H 0.308", .300
 * Lapua 0.310". The last three all take the same .308" bullet.
 *
 * ⚠️ SO THE GROUPING CANNOT BE A TOLERANCE CHAIN. A thou of spread inside one
 * calibre is the same size as the gap BETWEEN neighbouring calibres — .321"
 * (.32 Rem) and .323" (8mm) are two thou apart and are different bullets.
 * Chaining anything within a thou merges them.
 *
 * Instead each figure is snapped to the nearest diameter a reloader can
 * actually buy, and only when it lands close enough to be unambiguous.
 * Anything that does not is kept at its own figure, to the thou — which keeps
 * it in a group of its own rather than in a wrong one. The thou is the
 * resolution bullets are SOLD at, so two sheets that agree to a thou are the
 * same bullet; it is not a tolerance, and it never reaches across to a
 * standard diameter, because anything within half a thou of one has already
 * snapped to it.
 *
 * That is the safe direction to fail: too granular shows a member two rows
 * where one would do, while too coarse offers them a load their bullet does
 * not fit.
 */

/**
 * Bullet diameters that are actually sold, in inches.
 *
 * ⚠️ ADDING TO THIS LIST CHANGES HOW BULLETS ARE GROUPED. A value added here
 * pulls nearby cartridges into it; a value that is wrong merges two calibres
 * that must stay apart. Verified against all 172 C.I.P. sheets we hold —
 * see bullet-calibre.spec.ts.
 */
export const STANDARD_DIAMETERS_IN = [
  0.172, 0.204, 0.222, 0.224, 0.228, 0.243, 0.251, 0.257, 0.264, 0.277, 0.284,
  0.308, 0.311, 0.312, 0.315, 0.321, 0.323, 0.338, 0.348, 0.355, 0.357, 0.358,
  0.366, 0.375, 0.4, 0.406, 0.41, 0.416, 0.427, 0.429, 0.452, 0.458, 0.51,
] as const;

export const MM_PER_INCH = 25.4;

/**
 * How far C.I.P.'s maximum sits above the nominal bullet a reloader buys.
 *
 * ⚠️ SEVEN TEN-THOUSANDTHS, WHICH IS NOT WHAT ANY SINGLE SHEET SHOWS — IT IS
 * THE FIGURE THAT LEAVES EVERY SHEET THE MOST ROOM TO BE WRONG. What the
 * sheets actually publish, measured rather than assumed (they are all in
 * bullet-calibre.spec.ts, and they are what this figure was fitted to):
 *
 *     .223 Rem      5.69 mm = 0.22402"  for a .224" bullet   → 0.0000
 *     6,5 Creedmoor 6.72 mm = 0.26457"  for a .264" bullet   → 0.0006
 *     8x57 IS       8.22 mm = 0.32362"  for a .323" bullet   → 0.0006
 *     .303 British  7.92 mm = 0.31181"  for a .311" bullet   → 0.0008
 *     .308 Win      7.85 mm = 0.30906"  for a .308" bullet   → 0.0010
 *     .300 Lapua    7.87 mm = 0.30984"  for a .308" bullet   → 0.0018
 *
 * 🚨 A FULL THOU HERE MERGED FOUR PAIRS OF CALIBRES. Sheets that publish NO
 * allowance at all are common — .223 Rem is one — and taking a thou off those
 * puts them a thou BELOW their own bullet, which is exactly halfway to the
 * next standard down wherever the standards are two thou apart. Nearest-wins
 * then had a dead heat and broke it on list order: every .224" read as a
 * .222", every .323" 8mm as a .321" .32 Rem, every .429" as a .427", every
 * .357" as a .355". Where it did not tie outright it was luck — .223 Rem beat
 * .222" by 0.00003", on a sheet printed to a hundredth of a millimetre.
 *
 * ⚠️ THE TEST IS HEADROOM, NOT AVERAGE ERROR. What matters is how far a sheet
 * could be misread before it lands on a DIFFERENT bullet, and the binding
 * constraints pull opposite ways: too small and .300 Lapua (1.8 thou over)
 * drifts up into .311"; too large and .223 Rem (nothing over) drops into
 * .222". 0.0007 is where those two meet. Across the sheets above the worst
 * case moves from 0.001 mm — a TENTH of one printed step — to 0.009 mm, very
 * nearly a full step, and every one of them still lands on its own bullet.
 *
 * ⚠️ CHANGING THIS AFTER THE FIELD SHIPS REWRITES EVERY STORED BENCH. A
 * member's saved bullet holds the calibre this function returned; move the
 * constant and their bullet stops equalling the cartridges' new figures and
 * matches nothing, with nothing on screen saying why. It is free to move now,
 * before a single bench has been saved with one, and expensive afterwards.
 *
 * ⚠️ AND IT IS FITTED TO ELEVEN SHEETS OF THE 172 WE HOLD. Re-run it over all
 * of them when the sheets are to hand: the fit is only as good as the sample,
 * and a sheet with an unusual allowance on one of the two-thou pairs is the
 * one thing that would move it.
 */
export const CIP_MAX_ALLOWANCE_IN = 0.0007;

/**
 * How close a figure must land to be called a standard diameter.
 *
 * ⚠️ THE WINDOW DECIDES WHETHER TO SNAP AT ALL. It does NOT decide WHICH
 * standard: that is nearest-wins, and it is settled before the window is even
 * looked at. So the window being wider than the gap between two neighbours
 * does not merge them — a figure lands on whichever of the two it is nearer
 * to, and only a figure nearer to neither than 1.5 thou keeps its own value.
 *
 * ⚠️ WHERE TWO STANDARDS ARE ONE THOU APART — .311"/.312", .357"/.358" — a
 * figure between them is nearer one or the other by a hair, and a figure
 * exactly between them snaps to neither (see the dead-heat guard below).
 * Either way the answer is the same on every call rather than depending on
 * the order of the list, which matters because an unstable answer would split
 * one bullet across two picker rows between one opening and the next. Both of
 * those pairs are one projectile in practice — .303 British and 7.62x39 run
 * .311–.312 bullets — so landing on either is landing on the right bullet.
 *
 * ⚠️ WHAT IS NOT SAFE, AND IT IS NOT THIS: the pairs that are TWO thou apart
 * and are different bullets — .222"/.224" (5.45x39 against every other .22
 * centrefire), .321"/.323" (.32 Rem against 8mm), .355"/.357", .427"/.429".
 * Nearest-wins keeps those apart only while the figure is nearer its own
 * standard than the neighbour's, and the figure is a C.I.P. maximum less a
 * FIXED allowance while the real allowance varies by sheet. A sheet more than
 * 1.7 thou over its own bullet crosses the midpoint of a two-thou pair and
 * merges into its neighbour. The one observed sheet anywhere near that is
 * .300 Lapua at 1.8 thou, and its nearest neighbour is three thou away, so it
 * is safe — but nothing HERE can check that. Only a
 * run against the sheets can, which is what bullet-calibre.spec.ts pins those
 * pairs for. Moving this window, moving the allowance, or adding a diameter
 * between an existing two-thou pair all move that boundary.
 */
const SNAP_WINDOW_IN = 0.0015;

/**
 * The calibre a cartridge's bullets belong to, in inches, or null when the
 * cartridge has no C.I.P. sheet.
 *
 * Returns the standard diameter when the figure snaps to one, and otherwise
 * the measured figure itself — never a forced match.
 */
export function calibreFromG1(g1Mm: number | null | undefined): number | null {
  if (g1Mm == null || !Number.isFinite(g1Mm) || g1Mm <= 0) return null;

  const nominal = g1Mm / MM_PER_INCH - CIP_MAX_ALLOWANCE_IN;

  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  // 🚨 A DEAD HEAT IS NOT AN ANSWER, AND THE MERGE IT CAUSED WAS REAL. While
  // the allowance was a full thou, every sheet that published no allowance at
  // all came out a thou low — exactly halfway between two standards two thou
  // apart — and nearest-wins broke the tie on LIST ORDER: every .323" 8mm into
  // the .321" .32 Rem's group, every .224" into the .222", every .429" into
  // the .427". Different bullets, one row, and the results would have offered
  // a member loads their bullet does not chamber in.
  //
  // Recentring the allowance is what fixed those; this is the backstop for the
  // sheet we have not seen. A tie snaps to NEITHER: the cartridge keeps its
  // own figure and forms its own group, so the member sees an extra row
  // instead of a wrong one, which is this module's stated direction to fail
  // in.
  let tied = false;
  for (const std of STANDARD_DIAMETERS_IN) {
    const gap = Math.abs(std - nominal);
    if (gap < bestGap) {
      bestGap = gap;
      best = std;
      tied = false;
    } else if (gap === bestGap) {
      // Only ever the runner-up to the CURRENT best — the flag is cleared
      // above whenever a nearer standard replaces it.
      tied = true;
    }
  }

  // Close enough to be that bullet, and only one bullet it could be;
  // otherwise keep what was measured, to the thou.
  return best !== null && !tied && bestGap <= SNAP_WINDOW_IN
    ? best
    : Math.round(nominal * 1000) / 1000;
}

/** `.308"` — how a calibre is written on a shelf and in the picker. */
export function formatCalibre(inches: number | null): string {
  if (inches == null) return '';
  return `.${Math.round(inches * 1000)}"`;
}
