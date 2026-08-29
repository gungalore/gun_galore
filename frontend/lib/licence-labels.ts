// ────────────────────────────────────────────────────────────────────
// WHAT EACH LICENCE TYPE IS CALLED, IN THE MEMBER'S WORDS.
//
// The enum values come from Prisma (`MotivationLicenceType`); these are the
// words a person reads. There were two copies of this map before this file
// existed and they had already drifted — one called S24 "Renewal", the other
// "Renewing an existing licence".
//
// ⚠️ ONE PICKER LIST STAYS SEPARATE, ON PURPOSE. `app/motivations/page.tsx`
// carries a richer list for the "which licence are you applying for" screen:
// each option also has a section number and a blurb, which are picker copy and
// belong to that screen. Its labels should match these; if you change a label
// here, change it there too.
// ────────────────────────────────────────────────────────────────────

export const LICENCE_LABEL: Record<string, string> = {
  S13_SELF_DEFENCE: 'Self-defence',
  S15_OCCASIONAL_HUNTER: 'Occasional hunting or sport-shooting',
  S16_DEDICATED_HUNTER: 'Dedicated hunter',
  S16_DEDICATED_SPORT: 'Dedicated sports shooter',
  S24_RENEWAL: 'Renewing an existing licence',
};

/** The section of the Act each type is applied for under. */
export const LICENCE_SECTION: Record<string, string> = {
  S13_SELF_DEFENCE: 'Section 13',
  S15_OCCASIONAL_HUNTER: 'Section 15',
  S16_DEDICATED_HUNTER: 'Section 16',
  S16_DEDICATED_SPORT: 'Section 16',
  S24_RENEWAL: 'Section 24',
};

/**
 * A licence type in words, falling back to the raw value.
 *
 * ⚠️ FALLS BACK TO THE VALUE, NEVER TO A GUESS OR A BLANK. A type we do not
 * recognise is a type somebody added to the backend enum and not to this file;
 * printing the enum name is ugly and truthful, and a blank heading is neither.
 */
export function licenceLabel(type: string): string {
  return LICENCE_LABEL[type] ?? type;
}
