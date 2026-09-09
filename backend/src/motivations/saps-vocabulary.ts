// ────────────────────────────────────────────────────────────────────
// THE WORDS THE SAPS 271 USES.
//
// The form offers exactly four firearm types (section E item 1, and the same
// four again for each firearm already owned): Rifle, Shotgun, Handgun,
// Combination. Anything read off a licence card — "Semi-Auto Pistol", "Bolt
// Action Rifle", ".22 Carbine" — has to land on one of those four or the
// answer cannot be shown in the dropdown that holds it.
//
// ⚠️ ONE COPY, DELIBERATELY. This lived in two places that had drifted: the
// renewal one-tap emitted "Handgun" and the vault prefill emitted "Pistol",
// which is not a value the field accepts. Both now call this.
// ────────────────────────────────────────────────────────────────────

/** The only values `firearm_type` and `existing_firearm_N_type` accept. */
export const FIREARM_TYPES = [
  'Rifle',
  'Shotgun',
  'Handgun',
  'Combination',
] as const;

export type FirearmType = (typeof FIREARM_TYPES)[number];

/**
 * Map free text onto the form's four.
 *
 * ⚠️ COMBINATION IS TESTED FIRST. A combination gun is a rifle/shotgun in one
 * frame, so its description contains both those words — checking "shotgun"
 * first filed every combination gun as a shotgun.
 *
 * Returns '' when nothing matches, rather than guessing. A blank the applicant
 * fills in is recoverable; a confident wrong type on a form describing a
 * firearm they own is not.
 */
export function normaliseFirearmType(raw: string | undefined): FirearmType | '' {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('combination') || v.includes('combo')) return 'Combination';
  if (v.includes('shotgun')) return 'Shotgun';
  if (v.includes('rifle') || v.includes('carbine')) return 'Rifle';
  if (
    v.includes('pistol') ||
    v.includes('revolver') ||
    v.includes('handgun')
  ) {
    return 'Handgun';
  }
  return '';
}

/**
 * A calibre as it should be PRINTED, from whatever was typed or read.
 *
 * ⚠️ "9MM PAR ( 9X19MM )" APPEARED THREE TIMES IN MO000071, VERBATIM. That is
 * how the string sits on the operator's licence card — screaming case, a space
 * inside each bracket, an abbreviation nobody writes out — and it went into a
 * signed motivation three times exactly as read. A card is a source, not a
 * house style.
 *
 * ⚠️ IT NORMALISES SHAPE, NEVER MEANING. Spacing, bracket padding and case are
 * furniture; "PAR" is expanded because it is an abbreviation of one word and
 * nothing else. What this must NEVER do is decide that "9 mm" means 9 mm
 * Luger — that is `findCartridge`'s job, it refuses ambiguous stems on
 * purpose, and a printer quietly resolving them would put a cartridge name in
 * a document nobody chose.
 *
 * ⚠️ AND AN UNRECOGNISED STRING COMES BACK TIDIED, NOT DROPPED. A calibre we
 * do not know is still the calibre on the applicant's card.
 */
export function displayCalibre(raw: string | undefined | null): string {
  let v = (raw ?? '').trim();
  if (!v) return '';

  // Bracket padding: "( 9X19MM )" → "(9x19mm)". Done before anything else so
  // the case pass sees whole words.
  v = v.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  // Collapse runs of space, and put one space before an opening bracket.
  v = v.replace(/\s+/g, ' ').replace(/\s*\(/g, ' (');

  /**
   * ⚠️ SCREAMING CASE IS LOWERED; MIXED CASE IS LEFT ALONE. ".300 Win Mag" is
   * already how a person writes it, and title-casing everything would turn
   * "6.5mm Creedmoor" into "6.5Mm Creedmoor". Only a string that is ALL
   * capitals is being shouted by a card reader rather than written by anybody.
   */
  if (v === v.toUpperCase() && /[A-Z]{2}/.test(v)) {
    v = v
      .toLowerCase()
      .replace(/\b([a-z])/g, (m, c: string) => c.toUpperCase())
      // "9Mm" back to "9mm", and the same for the metric units.
      .replace(/\bMm\b/g, 'mm')
      .replace(/(\d)\s?Mm\b/g, '$1mm')
      .replace(/\bX(\d)/g, 'x$1');
  }

  // The abbreviations a card prints, expanded to the words a document uses.
  v = v
    .replace(/\bPar\b/g, 'Parabellum')
    .replace(/\bRem\b\.?/g, 'Remington')
    .replace(/\bWin\b\.?/g, 'Winchester')
    .replace(/\bSprg?\b\.?/g, 'Springfield')
    .replace(/\bMag\b\.?/g, 'Magnum')
    .replace(/\bGovt?\b\.?/g, 'Government');

  return v.trim();
}
