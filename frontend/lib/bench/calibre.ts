/**
 * THE BENCH — how a calibre is written on screen.
 *
 * 🚨 A WEIGHT IS NOT A BULLET. "Hornady 150gr SP" names four different
 * projectiles — .277" for .270 Win, .308" for .308 Win, .311" for .303
 * British, .323" for 8x57 IS — and they are not interchangeable. A bullet
 * three thou over will not chamber, or will chamber and spike pressure. So
 * every surface that NAMES a bullet has to show which one it is, and it has to
 * write it the way the box on the shelf does: `.308"`.
 *
 * ⚠️ MIRRORS backend/src/bench/bullet-calibre.ts formatCalibre() EXACTLY, and
 * exists only because the frontend cannot import from the backend package.
 * Same rounding, same leading dot, same trailing double-quote. A second,
 * slightly different formatter is how one screen ends up calling a bullet
 * .308" while the next calls the same bullet 0.31 in.
 *
 * ⚠️ AND IT ONLY EVER FORMATS. The figure itself is decided server-side by
 * calibreFromG1(), which snaps to a diameter a reloader can actually buy only
 * when that is unambiguous and otherwise keeps what was measured. Nothing here
 * may round, bucket or chain by tolerance: a thou of spread INSIDE one calibre
 * is the same size as the gap BETWEEN neighbouring ones (.321" .32 Rem against
 * .323" 8mm), so any tidying here would merge two calibres that must stay
 * apart.
 */

/** `.308"` — how a calibre is written on a shelf and in the picker. Empty when there is none. */
export function formatCalibre(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches)) return '';
  return `.${Math.round(inches * 1000)}"`;
}

/**
 * What a row says where the figure would go when the cartridge has none.
 *
 * ⚠️ SAID PLAINLY, NEVER LEFT BLANK. Five of the 177 cartridges give no
 * diameter, and a blank in the one column the member is choosing between reads
 * as "the same as the row above" rather than as "unknown".
 *
 * ⚠️ AND IT NAMES NO SOURCE. Operator ruling 2026-09-02: no Bench surface may
 * say where a figure comes from or fails to come from — so not "not published",
 * not "no C.I.P. sheet", not a count of anything underneath. See SAFETY_LINE in
 * components/bench/contract.ts, which is the same boundary.
 */
export const CALIBRE_UNKNOWN = 'Calibre unknown';

/** The chip-sized version of the same statement — a chip is one short line. */
export const CALIBRE_UNKNOWN_SHORT = 'no calibre';

/**
 * The strings a search should match a calibre on.
 *
 * A member types `308` for a calibre and `308` for a cartridge, and types it
 * with or without the leading dot, so all three spellings are indexed: `.308"`,
 * `308`, `0.308`. Loose on purpose — narrowing 1,139 rows to the .308 ones is
 * the point, and a stray weight that also reads 308 costs the member nothing.
 */
export function calibreSearchTokens(inches: number | null | undefined): string {
  const label = formatCalibre(inches);
  if (!label) return CALIBRE_UNKNOWN;
  const digits = label.slice(1, -1);
  return `${label} ${digits} 0.${digits}`;
}
