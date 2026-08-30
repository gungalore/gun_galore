// ────────────────────────────────────────────────────────────────────
// WHAT EACH LICENCE TYPE IS CALLED, IN THE MEMBER'S WORDS.
//
// The enum values come from Prisma (`MotivationLicenceType`); these are the
// words a person reads.
//
// ⚠️ ONE LIST NOW, DERIVED — NOT THREE HAND-SYNCED COPIES. There were two
// copies of this map before this file existed and they had already drifted
// (one called S24 "Renewal", the other "Renewing an existing licence"). This
// file then kept a third apart on purpose, because the picker on the
// Motivation Centre also needed a section number and a blurb, and that was
// called "picker copy that belongs to that screen".
//
// The picker has since moved into step one of the application itself, so there
// is no second screen to belong to — and a comment reading "if you change a
// label here, change it there too" is a bug waiting for somebody to be busy.
// LICENCE_LABEL and LICENCE_SECTION are now COMPUTED from the list below, so
// adding a type in one place adds it everywhere or fails to compile.
// ────────────────────────────────────────────────────────────────────

export interface LicenceTypeOption {
  /** The Prisma enum value. Sent to the server verbatim. */
  value: string;
  /** What a member calls it. */
  label: string;
  /** The section of the Act it is applied for under. */
  section: string;
  /** One line under the label, in the member's terms. */
  blurb: string;
}

/**
 * The five things somebody can apply for, in the order they are offered.
 *
 * ⚠️ ORDER IS DELIBERATE AND IT IS NOT THE ENUM'S. Self-defence leads because
 * it is the one most people come for; the renewal sits last because somebody
 * renewing knows exactly what they want and will not be scanning the list.
 *
 * ⚠️ NO OUTCOME LANGUAGE. Every blurb says who the section is FOR, never who
 * is likely to get it — see the Centre's own standing rule. "Endorsed by an
 * accredited association" is a requirement; "your best chance" would be a
 * prediction, and we do not make those.
 */
export const LICENCE_TYPES: readonly LicenceTypeOption[] = [
  {
    value: 'S13_SELF_DEFENCE',
    label: 'Self-defence',
    section: 'Section 13',
    blurb: 'One firearm — a handgun or a shotgun that is not fully automatic.',
  },
  {
    value: 'S15_OCCASIONAL_HUNTER',
    label: 'Occasional hunting or sport-shooting',
    section: 'Section 15',
    blurb: 'For someone who hunts or shoots, without dedicated status.',
  },
  {
    value: 'S16_DEDICATED_HUNTER',
    label: 'Dedicated hunter',
    section: 'Section 16',
    blurb: 'Endorsed by an accredited hunting association.',
  },
  {
    value: 'S16_DEDICATED_SPORT',
    label: 'Dedicated sports shooter',
    section: 'Section 16',
    blurb: 'Endorsed by an accredited sport-shooting association.',
  },
  {
    value: 'S24_RENEWAL',
    label: 'Renewing an existing licence',
    section: 'Section 24',
    blurb: 'The purpose has not changed — you are renewing what you hold.',
  },
];

export const LICENCE_LABEL: Record<string, string> = Object.fromEntries(
  LICENCE_TYPES.map((t) => [t.value, t.label]),
);

/** The section of the Act each type is applied for under. */
export const LICENCE_SECTION: Record<string, string> = Object.fromEntries(
  LICENCE_TYPES.map((t) => [t.value, t.section]),
);

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
