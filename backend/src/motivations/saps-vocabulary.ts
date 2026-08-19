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
