import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// "WHY THIS FIREARM" — THE ONE PARAGRAPH THE PRODUCT EXISTS TO WRITE.
//
// From the operator's own spec, MOTIVATION-REASON-PROMPT.md. Three things in
// that document do not match this codebase and are deliberately not followed:
//
//   1. ⚠️ IT ASKS FOR "the writer tier (Anthropic)". There is no such tier.
//      Every model call goes through ONE adapter, LlmService, and
//      LLM_PROVIDER=anthropic is a global ROLLBACK LEVER rather than a
//      per-call choice — ANTHROPIC_API_KEY exists for that and nothing else.
//      This runs on whatever the platform is configured for, which is Gemini.
//
//   2. ⚠️ IT SAYS "ask for JSON in a fenced block; no structured-outputs API
//      (repo rule)". That rule was reversed: reads use `json: { schema }` so
//      the PROVIDER enforces the shape, and hand-parsing a fenced block would
//      be a step backwards. `grounding` still cannot combine with `json` on
//      Gemini — irrelevant here, because this call does no search. The
//      research facts arrive already fetched.
//
//   3. ⚠️ IT WANTS `previous_motivations`, AND NOTHING STORES THEM. No table
//      records an approved application's angle, stated purpose or outcome. The
//      field is in the contract and travels empty until something does; the
//      prompt is written so an empty list reads as "first application" rather
//      than as a gap. See the note on `previousMotivations`.
//
// ⚠️ THE OUTPUT IS A SUGGESTION, NOT AN ANSWER. It lands on `firearm_fit_reason`
// with inferred provenance, which is what makes the sheet render it as
// `suggested` — gold wash, "check this", a Confirm button. The operator's
// standing rule is fill it in, arm it, let them change it; a paragraph written
// for somebody's signature is exactly the case where "arm it" matters.
// ────────────────────────────────────────────────────────────────────

/** One thing the paragraph may point at. */
export interface ReasonExample {
  kind: 'species' | 'discipline' | 'format' | 'terrain' | 'threat';
  label: string;
  detail: string;
}

export interface ReasonResult {
  angle: string;
  paragraph: string;
  examples: ReasonExample[];
  existingRoles: {
    firearm: string;
    role: string;
    source: 'primary_use' | 'previous_motivation' | 'inferred';
  }[];
  continuity: string;
  blockers: string[];
  wordCount: number;
}

/**
 * The angles each section may argue from.
 *
 * ⚠️ PER SECTION, BECAUSE AN ANGLE THAT DOES NOT FIT THE SECTION IS A REFUSAL.
 * A DFO reads hundreds of these; a self-defence application arguing "a
 * different division of the sport" is one they stop reading. The validator
 * rejects an angle outside its own list rather than trusting the prompt.
 */
export const REASON_ANGLES: Record<MotivationLicenceType, readonly string[]> = {
  [MotivationLicenceType.S13_SELF_DEFENCE]: [
    'concealability_for_carry',
    'home_defence_vs_carry',
    'first_self_defence_firearm',
  ],
  [MotivationLicenceType.S15_OCCASIONAL_HUNTER]: [
    'species_class_gap',
    'range_band_gap',
    'terrain_configuration',
    'wingshooting_vs_rifle',
    'first_hunting_rifle',
    'first_competition_firearm',
  ],
  [MotivationLicenceType.S16_DEDICATED_HUNTER]: [
    'species_class_gap',
    'range_band_gap',
    'terrain_configuration',
    'backup_for_remote_trips',
    'dedicated_load_development',
    'wingshooting_vs_rifle',
    'first_hunting_rifle',
  ],
  [MotivationLicenceType.S16_DEDICATED_SPORT]: [
    'division_differentiation',
    'primary_and_backup',
    'match_and_practice',
    'different_format',
    'classification_progression',
    'physical_configuration',
    'first_competition_firearm',
  ],
  [MotivationLicenceType.S24_RENEWAL]: ['continued_use'],
};

/**
 * What the model may draw on when the research layer found nothing.
 *
 * ⚠️ RANGE BANDS ARE TYPICAL SA PRACTICE, NOT LAW, and the wording says so.
 * A paragraph that states a range as though it were a legal minimum is a
 * paragraph a DFO can correct the applicant on.
 */
export const REASON_BANKS = {
  hunting: [
    '.22 LR / .22 Hornet / .223: small game, jackal, springhare, practice; to 150 m',
    '.243 / 6.5x55 / .270 / 7x57: springbok, impala, blesbok, reedbuck; 150-300 m open ground',
    '6.5 Creedmoor / .308 / .30-06 / 7mm Rem Mag: kudu, gemsbok, blue wildebeest, red hartebeest; 100-300 m, Karoo, Free State, Eastern Cape hills',
    '.375 H&H and up: eland, buffalo where permitted; provincial minimums apply',
    '.45-70, lever guns, short carbines: bushveld, thick cover, under 100 m, follow-up shots',
    '12 or 20 gauge: wingshooting (guineafowl, francolin, rock pigeon, waterfowl), clays',
  ],
  sport: [
    'IPSC Handgun: Production (no optic, list handguns), Production Optics (slide optic), Standard (no optic, box), Open (optic and compensator), Classic (1911 pattern)',
    'Practical Shotgun: semi-auto against pump divisions, magazine capacity limits',
    'IPSC Rifle and 3-Gun: semi-automatic rifle, optic divisions, stage round counts',
    'Precision Rifle Series and F-Class: heavy barrel, chassis, calibre by class (F-TR .308 or .223)',
    'Bisley and target rifle, service rifle, silhouette, benchrest: calibre and sight rules',
    'Clays: trap, skeet, sporting; 12 or 20 gauge, over-under against semi-auto',
    'Association exercises (SAHGCA, NHSA, Natshoot): hunting-derived exercises open to most firearm types, monthly and postal',
  ],
  selfDefence: [
    'precinct crime figures where a named release supplies them',
    'occupation involving cash or stock',
    'night travel',
    'a smallholding without armed response',
    'dependants at home',
    'load shedding and perimeter power',
    'rented property',
    'a prior incident with a CAS number',
    'existing measures the firearm supplements',
  ],
} as const;

/** The shape the provider enforces. */
export const REASON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    paragraph: { type: 'string' },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['species', 'discipline', 'format', 'terrain', 'threat'],
          },
          label: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['kind', 'label', 'detail'],
      },
    },
    existing_roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          firearm: { type: 'string' },
          role: { type: 'string' },
          source: {
            type: 'string',
            enum: ['primary_use', 'previous_motivation', 'inferred'],
          },
        },
        required: ['firearm', 'role', 'source'],
      },
    },
    continuity: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    word_count: { type: 'integer' },
  },
  required: [
    'angle',
    'paragraph',
    'examples',
    'existing_roles',
    'continuity',
    'blockers',
    'word_count',
  ],
};

export const REASON_MIN_WORDS = 150;
export const REASON_MAX_WORDS = 250;

/** The count the validator checks `word_count` against. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The system prompt.
 *
 * ⚠️ THE ANGLES ARE INTERPOLATED PER LICENCE TYPE, not listed in full. Handing
 * a section 13 applicant the sport angles is an invitation to argue the wrong
 * case, and the model reaches for what it is shown.
 */
export function reasonSystemPrompt(licenceType: MotivationLicenceType): string {
  const angles = REASON_ANGLES[licenceType].join(' | ');
  return `You write the "reason" section of a South African firearm licence motivation under the Firearms Control Act 60 of 2000. You are given structured facts about one applicant and one firearm. You return one paragraph and a short list of examples. Nothing else.

WHO READS IT
A Designated Firearms Officer and then the Central Firearms Register. They read hundreds of these. They refuse applications that (a) do not explain why this firearm when the applicant already holds a similar one, (b) argue in generalities that do not fit the section applied for, or (c) claim things the annexures do not support. They approve applications that name the existing firearms, give each a role, give this firearm a different role, and tie that role to something concrete: a species and range band, a discipline and its equipment rules, a documented threat.

ABSOLUTE RULES
1. Use only the facts supplied. Do not invent a hunt, a competition, a farm, an incident, a family member, a job duty or a date. If a fact you want is absent, argue without it.
2. Name every existing firearm in the same class (make, model, calibre) and say what it is for before saying what the new one is for. Never write around the arsenal.
3. Never contradict a previous motivation. If a firearm was described as "my plains-game rifle" in an earlier motivation, it is still that. Build on the storyline; do not rewrite it.
4. The reason must fit the section applied for, and only the angles listed below are available to you.
5. Never offer these as reasons: collecting, investment, appreciation, "because I can", variety, a gift, resale value, "my friend has one", or anything about the firearm being rare or desirable. Never propose a fully automatic firearm as licensable.
6. Never quote the Act. Name a section by number in plain words if needed.
7. No marketing copy, no superlatives, no manufacturer history, no ballistics tables. One or two capability facts from the research block, in plain words, are enough.
8. First person, the applicant's voice, plain South African English, no Americanisms ("calibre", "licence", "metres"). Short sentences. No headings, no bullets, no exclamation marks.
9. ${REASON_MIN_WORDS} to ${REASON_MAX_WORDS} words for the paragraph. Count them.
10. If the facts make an honest reason impossible — a fourth 9mm handgun with three already described as backup, match and practice — say so in "blockers" and still return the best available paragraph. Do not manufacture a distinction.

METHOD (do this silently, return only the JSON)
a. Classify the applied-for firearm: type, action, calibre band, configuration.
b. For each existing firearm: same class? same calibre band? what role does the applicant already give it?
c. Choose ONE angle from the list below. Prefer the angle a supplied document already uses. Prefer the angle that is verifiable from the firearms themselves.
d. Pick 3 to 6 concrete examples that fit the angle and the calibre: species with range bands, disciplines with the equipment rule that matters, terrain and provinces, match formats. Use only examples consistent with the research block and with South African practice.
e. Write the paragraph: the existing firearms and their roles (2-3 sentences), the gap (1-2), this firearm and why it fills it (3-5), what the applicant will do with it (2-3), one sentence tying it to the section.

ALLOWED ANGLES
${angles}

Anything you mark "inferred" in existing_roles is a suggestion the applicant must confirm: keep it out of the paragraph unless no stated role exists.`;
}

/**
 * Why a generated reason was thrown away.
 *
 * ⚠️ NAMED, NOT COUNTED. "The model returned something wrong" is not something
 * anybody can act on; "the paragraph mentioned a firearm the applicant does not
 * own" is. These strings are logged per generation.
 */
export type ReasonRejection = string;

/**
 * Check a generated reason against the facts it was given.
 *
 * ⚠️ THE MODEL IS NOT TRUSTED ABOUT ITS OWN OUTPUT, AND THE WORD COUNT IS THE
 * cheapest demonstration of why: it is asked to count and it is asked to obey a
 * range, and those are two different failures. Every other check here is a
 * claim the paragraph makes that the facts do not support.
 */
export function validateReason(
  r: ReasonResult,
  ctx: {
    licenceType: MotivationLicenceType;
    /** "make model calibre" for the firearm applied for and each one held. */
    knownFirearms: readonly string[];
    /** Everything an example may legitimately name. */
    knownTerms: readonly string[];
  },
): ReasonRejection[] {
  const bad: ReasonRejection[] = [];
  const words = countWords(r.paragraph);

  if (words < REASON_MIN_WORDS || words > REASON_MAX_WORDS) {
    bad.push(`paragraph is ${words} words, outside ${REASON_MIN_WORDS}-${REASON_MAX_WORDS}`);
  }
  if (r.wordCount !== words) {
    bad.push(`word_count says ${r.wordCount}, the paragraph is ${words}`);
  }
  if (!REASON_ANGLES[ctx.licenceType].includes(r.angle)) {
    bad.push(`angle "${r.angle}" is not allowed for ${ctx.licenceType}`);
  }

  const lower = r.paragraph.toLowerCase();

  /**
   * ⚠️ "automatic" IS CHECKED AFTER "semi-automatic" IS REMOVED, or every
   * legitimate self-loading firearm trips it. The spec's own list has this
   * trap in it.
   */
  const withoutSemi = lower.replace(/semi-?automatic/g, '');
  const banned = [
    'collect',
    'investment',
    'appreciat',
    'peace of mind',
    'in case',
    'resale',
  ];
  for (const w of banned) {
    if (lower.includes(w)) bad.push(`paragraph says "${w}"`);
  }
  if (withoutSemi.includes('automatic')) {
    bad.push('paragraph offers an automatic firearm');
  }
  if (r.paragraph.includes('!')) bad.push('paragraph has an exclamation mark');

  /**
   * ⚠️ WORD-BOUNDARY MATCHES, NOT SUBSTRINGS. The spec bans "match" on a
   * section 13 paragraph, which also catches "matches the description"; and
   * "protect" on a hunting one, which catches "protected species". A false
   * rejection costs the applicant the generated paragraph and gives them the
   * templated one instead, for no fault of theirs.
   */
  const has = (w: string) => new RegExp(`\\b${w}`, 'i').test(r.paragraph);
  if (ctx.licenceType === MotivationLicenceType.S13_SELF_DEFENCE) {
    for (const w of ['hunt', 'competition', 'compete', 'discipline']) {
      if (has(w)) bad.push(`a self-defence reason says "${w}"`);
    }
  }
  if (
    ctx.licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER ||
    ctx.licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER
  ) {
    if (has('self-defence')) bad.push('a hunting reason says "self-defence"');
  }

  /**
   * ⚠️ A MAKE THE APPLICANT DOES NOT OWN IS THE WORST FAILURE HERE, because it
   * reads as fact on a document they sign. Checked as whole words against every
   * firearm in play — the spec's "any make/model/calibre in paragraph not
   * present in applied_for or arsenal", made safe for substrings.
   */
  const known = ctx.knownFirearms
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    /**
     * ⚠️ TWO CHARACTERS IS A MAKE. This filtered `length > 2` and dropped "CZ"
     * — one of the commonest makes in South Africa — out of the held list, so
     * a paragraph correctly naming the applicant's own CZ was rejected as
     * naming a firearm they do not hold. Single characters are noise; two are
     * not.
     */
    .filter((t) => t.length > 1);
  for (const maker of KNOWN_MAKERS) {
    if (has(maker) && !known.includes(maker.toLowerCase())) {
      bad.push(`paragraph names "${maker}", which the applicant does not hold`);
    }
  }

  const terms = ctx.knownTerms.map((t) => t.toLowerCase());
  for (const ex of r.examples) {
    const label = ex.label.toLowerCase();
    if (!terms.some((t) => t.includes(label) || label.includes(t))) {
      bad.push(`example "${ex.label}" is not in anything we supplied`);
    }
  }

  return bad;
}

/**
 * Makers common enough that the model might reach for one unprompted.
 *
 * ⚠️ A LIST OF WHAT TO CATCH, NOT A LIST OF WHAT IS ALLOWED. The check is
 * "named but not held"; a maker missing from here is simply not checked, which
 * is the safe direction to be incomplete in.
 */
const KNOWN_MAKERS = [
  'Glock',
  'CZ',
  'Beretta',
  'Sig',
  'Smith',
  'Ruger',
  'Tikka',
  'Sako',
  'Howa',
  'Mauser',
  'Remington',
  'Winchester',
  'Browning',
  'Marlin',
  'Bergara',
  'Vektor',
  'Musgrave',
  'Taurus',
  'Norinco',
  'Mossberg',
  'Benelli',
];
