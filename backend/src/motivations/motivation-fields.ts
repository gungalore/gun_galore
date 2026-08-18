import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// What we ask an applicant, per licence type.
//
// THIS IS THE CONTRACT between the form, the interview, the fact pack and the
// quality gate. A field key appears in four places — the wizard renders it, a
// Boet follow-up targets it, the generator reads it, and the gate names it in
// thinFields when the answer is too thin — so it is defined exactly once here.
//
// WHY A REGISTRY AND NOT A FREE-FORM PROMPT. The generator is only allowed to
// arrange facts we already hold; it never invents circumstances for someone's
// firearm application. Registering the fields is what makes that enforceable:
// the fact pack is built from these keys and nothing else.
//
// NOTHING HERE IS PII. These are field DEFINITIONS — keys, labels, prompts.
// The ANSWERS are encrypted (Motivation.answersEncrypted). That split is why
// thinFields and extractedFields can stay queryable in the clear: a key like
// "safe_storage_detail" is metadata, its value is not.
//
// VERSIONED. answersSchemaVersion is stamped on every motivation so a later
// change here can be told from an older blob rather than guessed at. Bump
// FIELD_REGISTRY_VERSION whenever a key is added, removed or re-meant.
// ────────────────────────────────────────────────────────────────────

export const FIELD_REGISTRY_VERSION = '2026-08-18';

export type MotivationFieldKind = 'short' | 'long' | 'date' | 'choice';

export interface MotivationField {
  key: string;
  label: string;
  kind: MotivationFieldKind;
  /** Section the wizard groups it under. */
  section: string;
  /** Shown under the input. Plain, no legalese. */
  help?: string;
  choices?: readonly string[];
  /** Required to generate at all. Optional fields still improve the document. */
  required?: true;
  /**
   * True when the value is personal enough that it must never be echoed into a
   * log line, an admin list view or an error message. Everything is encrypted
   * at rest; this flags what is sensitive even in transit through our own code.
   */
  sensitive?: true;
  /**
   * Long answers carry the applicant's own voice into the document, so they are
   * NOT run through sanitizePromptValue (which collapses newlines and truncates
   * at 120 chars — it would destroy them). They are delimited and marked as
   * untrusted in the prompt instead. Short scalars are sanitised normally.
   */
  maxLength?: number;
}

/** Asked for every licence type. */
const COMMON_FIELDS: readonly MotivationField[] = [
  {
    key: 'full_name',
    label: 'Full name, as it appears on your ID',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 120,
  },
  {
    key: 'id_number',
    label: 'SA ID number',
    kind: 'short',
    section: 'About you',
    required: true,
    sensitive: true,
    maxLength: 13,
  },
  {
    key: 'residential_address',
    label: 'Residential address',
    kind: 'long',
    section: 'About you',
    help: 'Where the firearm will be kept.',
    required: true,
    sensitive: true,
    maxLength: 400,
  },
  {
    key: 'occupation',
    label: 'Occupation',
    kind: 'short',
    section: 'About you',
    required: true,
    maxLength: 120,
  },
  {
    key: 'competency_number',
    label: 'Competency certificate number',
    kind: 'short',
    section: 'About you',
    help: 'From your competency certificate. Leave blank if the application is still pending.',
    sensitive: true,
    maxLength: 60,
  },
  {
    key: 'firearm_description',
    label: 'The firearm you are applying for',
    kind: 'short',
    section: 'The firearm',
    help: 'Make, model and calibre.',
    required: true,
    maxLength: 160,
  },
  {
    key: 'firearm_fit_reason',
    label: 'Why this particular firearm suits the purpose',
    kind: 'long',
    section: 'The firearm',
    help: 'Calibre, action and configuration against what you actually intend to do with it.',
    required: true,
    maxLength: 2000,
  },
  {
    key: 'safe_storage_detail',
    label: 'How and where it will be stored',
    kind: 'long',
    section: 'Storage and safety',
    help: 'The safe, how it is fixed, where it is, and who else can reach it.',
    required: true,
    sensitive: true,
    maxLength: 2000,
  },
  {
    key: 'other_licensed_firearms',
    label: 'Firearms already licensed to you',
    kind: 'long',
    section: 'Storage and safety',
    help: 'Leave blank if this is your first.',
    maxLength: 1000,
  },
  {
    key: 'prior_refusals',
    label: 'Previous applications refused, or licences cancelled',
    kind: 'long',
    section: 'History',
    help: 'Say so plainly if it has happened, with the reason given. Concealing it is far worse than explaining it.',
    maxLength: 2000,
  },
];

/** Extra fields per licence type, appended to the common set. */
const TYPE_FIELDS: Record<MotivationLicenceType, readonly MotivationField[]> = {
  S13_SELF_DEFENCE: [
    {
      key: 'threat_circumstances',
      label: 'The circumstances that make you believe you need it',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Specific to you and where you live or work — times, places, incidents, routes. General crime statistics carry no weight on their own.',
      required: true,
      sensitive: true,
      maxLength: 4000,
    },
    {
      key: 'daily_movements',
      label: 'Your routine — where you go and when',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Travel at night, cash handling, isolated premises, long rural commutes.',
      required: true,
      sensitive: true,
      maxLength: 2000,
    },
    {
      key: 'alternatives_considered',
      label: 'What else you have done about it',
      kind: 'long',
      section: 'Your circumstances',
      help: 'Alarms, armed response, changed routines, relocation. Shows a firearm is not the first thing you reached for.',
      maxLength: 2000,
    },
  ],
  S15_OCCASIONAL_HUNTER: [
    {
      key: 'hunting_history',
      label: 'Your hunting experience',
      kind: 'long',
      section: 'Experience',
      help: 'How long, where, what species, roughly how often.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'intended_quarry',
      label: 'What you intend to hunt with it',
      kind: 'short',
      section: 'Experience',
      required: true,
      maxLength: 200,
    },
    {
      key: 'hunting_locations',
      label: 'Where you hunt',
      kind: 'long',
      section: 'Experience',
      help: 'Properties, provinces, whether by invitation or as a paying guest.',
      maxLength: 1500,
    },
  ],
  S16_DEDICATED_HUNTER: [
    {
      key: 'association_name',
      label: 'Your hunting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
    },
    {
      key: 'hunting_history',
      label: 'Your hunting record',
      kind: 'long',
      section: 'Experience',
      help: 'Species, terrain, ranges, roughly how many hunts a year.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'activity_record',
      label: 'Association activities in the last 24 months',
      kind: 'long',
      section: 'Experience',
      help: 'Hunts logged, shoots attended, courses, committee roles.',
      maxLength: 2000,
    },
  ],
  S16_DEDICATED_SPORT: [
    {
      key: 'association_name',
      label: 'Your sport-shooting association',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      maxLength: 160,
    },
    {
      key: 'association_number',
      label: 'Membership number',
      kind: 'short',
      section: 'Dedicated status',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'dedicated_since',
      label: 'Dedicated status held since',
      kind: 'date',
      section: 'Dedicated status',
      required: true,
    },
    {
      key: 'discipline',
      label: 'The discipline you shoot',
      kind: 'short',
      section: 'Experience',
      help: 'Practical, precision, clay, service rifle, and so on.',
      required: true,
      maxLength: 160,
    },
    {
      key: 'competition_record',
      label: 'Competitions and range attendance',
      kind: 'long',
      section: 'Experience',
      help: 'Matches shot in the last two years, classifications, results if relevant.',
      required: true,
      maxLength: 3000,
    },
    {
      key: 'discipline_requirement',
      label: 'What the discipline requires of the firearm',
      kind: 'long',
      section: 'Experience',
      help: 'Where the rules constrain calibre, barrel, sights or capacity.',
      maxLength: 2000,
    },
  ],
  S24_RENEWAL: [
    {
      key: 'existing_licence_number',
      label: 'The licence being renewed',
      kind: 'short',
      section: 'The existing licence',
      required: true,
      sensitive: true,
      maxLength: 60,
    },
    {
      key: 'licence_expiry',
      label: 'Expiry date',
      kind: 'date',
      section: 'The existing licence',
      required: true,
    },
    {
      key: 'continued_use',
      label: 'How you have used it, and why that continues',
      kind: 'long',
      section: 'The existing licence',
      help: 'The purpose has not changed — say what you have actually done with it since it was issued.',
      required: true,
      maxLength: 3000,
    },
  ],
};

/** Human label for the document header and the UI. */
export const LICENCE_TYPE_LABELS: Record<MotivationLicenceType, string> = {
  S13_SELF_DEFENCE: 'Section 13 — Self-defence',
  S15_OCCASIONAL_HUNTER: 'Section 15 — Occasional hunter / sport shooter',
  S16_DEDICATED_HUNTER: 'Section 16 — Dedicated hunter',
  S16_DEDICATED_SPORT: 'Section 16 — Dedicated sport shooter',
  S24_RENEWAL: 'Section 24 — Renewal',
};

/** Every field for a licence type, common first, in wizard order. */
export function fieldsFor(
  type: MotivationLicenceType,
): readonly MotivationField[] {
  return [...COMMON_FIELDS, ...(TYPE_FIELDS[type] ?? [])];
}

/** Fast lookup by key, for merging an interview answer back into the blob. */
export function fieldByKey(
  type: MotivationLicenceType,
  key: string,
): MotivationField | undefined {
  return fieldsFor(type).find((f) => f.key === key);
}

/** Keys that must be answered before a document can be generated. */
export function requiredKeys(type: MotivationLicenceType): string[] {
  return fieldsFor(type)
    .filter((f) => f.required)
    .map((f) => f.key);
}

/**
 * Drop anything that is not a registered field for this licence type, trim
 * strings, and enforce per-field length caps.
 *
 * Called on EVERY write. Two reasons: an unregistered key would sit in the
 * encrypted blob forever without the generator or the gate ever knowing what
 * to do with it, and an unbounded string is both a storage and a token-cost
 * problem. Returns the clean patch plus what it rejected, so the caller can
 * tell the difference between "saved nothing" and "saved everything".
 */
export function sanitiseAnswers(
  type: MotivationLicenceType,
  patch: Record<string, unknown>,
): { answers: Record<string, string>; rejected: string[] } {
  const answers: Record<string, string> = {};
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(patch ?? {})) {
    const field = fieldByKey(type, key);
    if (!field) {
      rejected.push(key);
      continue;
    }
    if (raw === null || raw === undefined) {
      // An explicit clear is a legitimate edit — the applicant deleting
      // something they had typed.
      answers[key] = '';
      continue;
    }
    if (typeof raw !== 'string') {
      rejected.push(key);
      continue;
    }
    const trimmed = raw.trim();
    const cap = field.maxLength ?? 2000;
    answers[key] = trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
  }

  return { answers, rejected };
}

/**
 * Which required fields are still empty. Drives both "can this generate yet"
 * and the wizard's progress display.
 */
export function missingRequired(
  type: MotivationLicenceType,
  answers: Record<string, string>,
): string[] {
  return requiredKeys(type).filter((k) => !(answers[k] ?? '').trim());
}
