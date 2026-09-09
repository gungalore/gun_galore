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
// ⚠️ WHAT THE APPROVED PACKS CHANGED. MOTIVATION-CORPUS-LEARNINGS.md reads
// ten motivations written by paid writers, nine of them approved by the CFR,
// and its finding is uncomfortable: the Registrar approved a fourth 9mm
// argued from a generic product comparison, a 1,200-word essay that never
// named the applicant's own firearms, and an S15 pack whose existing-firearms
// section read "see attached". What carries a pack is the BUNDLE — dedicated
// status, an endorsement for this serial, the association's exercise rules
// bound in, competency, safe photographs, every claim pointing at an annexure.
//
// So a gate that REFUSES TO WRITE because a distinction is thin is stricter
// than the Registrar, and would block applications that would pass. Rule 10 is
// a warning now, not a stop: `warnings` is for the applicant's eyes.
//
// ⚠️ AND THE REAL REFUSAL TRIGGER IS THE OPPOSITE MISTAKE. A live generation
// off the operator's own vault described his section 16 CZ as "dedicated to
// backup use and close protection" and invented a role for all five of his
// firearms, none of which had one supplied. Describing a section 16 firearm as
// backup or carry tells the Registrar the applicant uses a sport firearm
// outside its licence — that is a refusal on its own, and it is what rules 11,
// 12 and 15 are for.
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
    /**
     * Where the role came from.
     *
     * ⚠️ 'none' IS A REAL ANSWER AND THE MOST IMPORTANT ONE. A firearm whose
     * role nobody has stated has no role, and the model's job is to say so
     * rather than to supply one. 'endorsement' is the association's own words
     * on the SAHGCA form — the strongest source there is, because the pack
     * annexes the form itself.
     */
    source: 'primary_use' | 'previous_motivation' | 'endorsement' | 'inferred' | 'none';
  }[];
  continuity: string;
  /**
   * Things the Registrar may ask about.
   *
   * ⚠️ FOR THE APPLICANT'S EYES, NEVER A GATE, and it used to be called
   * `blockers`, which is what it behaved like. The approved packs on file
   * include a fourth 9mm argued from a product comparison; refusing to write
   * because a distinction is thin is stricter than the Registrar and blocks
   * applications that would pass.
   */
  warnings: string[];
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
    'exercise_eligibility',
    'species_class_gap',
    'range_band_gap',
    'terrain_configuration',
    'wingshooting_vs_rifle',
    'first_hunting_rifle',
    'first_competition_firearm',
  ],
  [MotivationLicenceType.S16_DEDICATED_HUNTER]: [
    'exercise_eligibility',
    'species_class_gap',
    'range_band_gap',
    'terrain_configuration',
    'backup_for_remote_trips',
    'dedicated_load_development',
    'wingshooting_vs_rifle',
    'first_hunting_rifle',
  ],
  [MotivationLicenceType.S16_DEDICATED_SPORT]: [
    /**
     * ⚠️ FIRST BECAUSE IT IS PREFERRED, AND THE ORDER IS WHAT THE MODEL SEES.
     * The approved packs' strongest argument is an association exercise the
     * applied-for firearm is eligible for and a held one is not, by the
     * association's own printed equipment rule — "7m 2x5 shot: only 9mmP
     * pistols and larger" against a 6.35mm pocket pistol. That is a gap a
     * reviewer can check against the annexed rules, and it beats any calibre
     * opinion.
     */
    'exercise_eligibility',
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
            enum: [
              'primary_use',
              'previous_motivation',
              'endorsement',
              'inferred',
              'none',
            ],
          },
        },
        required: ['firearm', 'role', 'source'],
      },
    },
    continuity: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    word_count: { type: 'integer' },
  },
  required: [
    'angle',
    'paragraph',
    'examples',
    'existing_roles',
    'continuity',
    'warnings',
    'word_count',
  ],
};

/**
 * ⚠️ 180-320, RAISED FROM 150-250, AND THE REASON IS THE BATTERY SENTENCE.
 * The paragraph now has to name each held firearm with its calibre and the
 * section it is licensed under, the way the approved packs' tables do, before
 * it can get to the gap — and a battery of five does not fit in 150 words
 * without dropping firearms, which rule 2 forbids. A battery of one still
 * does, so the prompt says to stay near the floor when there is little to say.
 */
export const REASON_MIN_WORDS = 180;
export const REASON_MAX_WORDS = 320;

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
/**
 * The angles this application may actually argue.
 *
 * ⚠️ `exercise_eligibility` IS WITHHELD UNTIL SOMETHING CAN FEED IT, and that
 * is not tidiness — it is the same rule as "do not draw a door onto an empty
 * list". The angle's whole substance is the association's printed equipment
 * rule, and rule 16 forbids asserting one we cannot annex. Offering it anyway
 * is asking the model to argue a case and then refusing every sentence it
 * writes: two live generations in a row died that way, one on "restricted to"
 * and one on a paragraph that shrank under the floor while trying to avoid it.
 */
export const EXERCISE_ANGLE = 'exercise_eligibility';

export function anglesFor(
  licenceType: MotivationLicenceType,
  hasActivityRules: boolean,
): readonly string[] {
  const all = REASON_ANGLES[licenceType];
  return hasActivityRules ? all : all.filter((a) => a !== EXERCISE_ANGLE);
}

export function reasonSystemPrompt(
  licenceType: MotivationLicenceType,
  hasActivityRules = false,
): string {
  const angles = anglesFor(licenceType, hasActivityRules).join(' | ');
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
9. ${REASON_MIN_WORDS} to ${REASON_MAX_WORDS} words, as TWO paragraphs separated by a blank line: the battery and the gap, then this firearm and its use. Count them. A battery of five needs the room; a battery of one does not, so stay near the floor when there is little to say.
10. If the facts leave the distinction thin — a fourth 9mm handgun with three already described as backup, match and practice — say so in "warnings" and still write the best honest paragraph. Do not manufacture a distinction and do not refuse to write. The warning is for the applicant to read, not a reason to stop.

SECTION DISCIPLINE FOR EXISTING FIREARMS — THIS IS WHERE REFUSALS COME FROM
11. An existing firearm's entry carries a "section" ONLY when we could read it off the member's own licence card. Where it is there, name it and let it fix the words you may use about that firearm. WHERE IT IS ABSENT, SAY NOTHING ABOUT WHICH SECTION THAT FIREARM IS LICENSED UNDER — do not take it from the section being applied for, do not take it from the other firearms, and do not write "all licensed under section N" over a battery where only some carry one. A wrong section tells the Registrar the applicant does not know what their own licences say. The sections and the words each permits:
    - section 13 or 14: self-defence, carry, protection of the person. Nothing else.
    - section 15: occasional hunting or sport shooting. Never self-defence, protection, backup, carry or home defence.
    - section 16: dedicated hunting or dedicated sport shooting. Never self-defence, protection, backup, carry or home defence.
    - section 17: collection. Never a use of any kind.
    Describing a section 16 handgun as "backup" or "close protection" tells the Registrar the applicant uses a sport firearm outside its licence. That is a refusal on its own.
12. A role for an existing firearm comes ONLY from its supplied primary_use, or from a previous motivation, or from an association endorsement. If none was supplied, DO NOT ASSIGN ONE. Write the firearm with its make, calibre and section and nothing more — "a CZ in 6.35mm Browning, licensed under section 16" — list it in existing_roles with source "none", and add "roles_unconfirmed" to warnings. Never write "for precision work", "for small-game", "for backup" or any role you were not given.
13. Makes, models, calibres and association names appear only as they appear in the input, spelled the same way. If no model was supplied, write "the 9mm handgun applied for", not a model you believe is likely. If no association is in the input, name none.
14. Discipline, exercise and division names come only from the input. Do not supply divisions from memory and do not name another association's disciplines. "Carry Optics" is a USPSA division and does not exist in South African shooting.
15. Banned phrasing, because it reads like a product page and not like an applicant: power factor, split times, high-volume, platform, tactical, close protection, engage targets, dynamic, competitively, efficiently, and "dedicated" used as a synonym for "used for".
16. YOU MAY NOT STATE A RULE NOBODY GAVE YOU. If the input carries no association exercises, then you do not know what any exercise is shot with, what its entry conditions are, or at what distance. Do not write "requirements", "criteria", "eligible", "restricted to" or any distance in metres. Rest the gap on what the pack can prove: the TYPE of firearm and the SECTION it is licensed under. "None of my rifles can be used in a handgun exercise" is provable from the firearms themselves; "cannot meet the capacity requirements" is not, and an applicant who cannot produce the rule they quoted has damaged their own application.

THE BATTERY SENTENCE names each held firearm with make and calibre, and its section where its entry carries one, the way the approved packs' tables do: "a CZ 6.35mm handgun, licensed under section 16". A firearm whose entry has no section is named with make and calibre and nothing else. Where the history answers disclose an event, state it in the same breath and plainly: "(section 13; reported stolen, CAS 123/4/2024)".

METHOD (do this silently, return only the JSON)
a. Classify the applied-for firearm: type, action, calibre band, configuration.
b. For each existing firearm: same class? same calibre band? what role does the applicant already give it?
c. Choose ONE angle from the list below. Prefer the angle a supplied document already uses. Prefer the angle that is verifiable from the firearms themselves.
d. Pick 3 to 6 concrete examples that fit the angle and the calibre: species with range bands, disciplines with the equipment rule that matters, terrain and provinces, match formats. Use only examples consistent with the research block and with South African practice.
e. Write the paragraph: the existing firearms and their roles (2-3 sentences), the gap (1-2), this firearm and why it fills it (3-5), what the applicant will do with it (2-3), one sentence tying it to the section.

ALLOWED ANGLES
${angles}

${
    hasActivityRules
      ? `PREFERRED ANGLE: exercise_eligibility. The input carries association exercises with their equipment rules — a calibre floor or ceiling, a barrel length, an action or a class. Where the applied-for firearm meets one and a held firearm of the same type does not, lead with it and quote the rule. "The association's 7m rapid-fire handgun exercise is open only to 9mmP pistols and larger; my 6.35mm CZ shoots the 5m pocket-pistol exercise and cannot enter it." That is a gap the reviewer can check against the rules annexed to the same pack, and it is what the approved motivations on file actually do.`
      : `NO ASSOCIATION EXERCISES WERE SUPPLIED, so you do not know what any exercise is shot with. Rest the gap on the two things the firearms themselves prove: TYPE and SECTION. "None of my rifles can be used in a handgun exercise" is provable; "cannot meet the capacity requirements" is not.

HOW TO REACH THE WORD FLOOR WITHOUT INVENTING ANYTHING. Name every held firearm with make and calibre, and its own section where its entry carries one — as ONE sentence with commas, the way a table row reads, not as one sentence per firearm. "I hold a Mauser in .30-06 Springfield and a Marlin in .45-70 Government under section 16, and a Howa in 6.5mm Creedmoor under section 15." Five sentences each beginning "I hold a" is a list, not a person writing, and one blanket "all licensed under section 16" over a mixed battery is false. Say what class of shooting the applied-for firearm opens that the held ones do not, in plain terms of type and action. Say what the applicant will do with it, in the words the input gives you. That is the length; padding it with capability claims is what rule 16 refuses.`
  }

Anything you mark "inferred" in existing_roles is a suggestion the applicant must confirm: keep it out of the paragraph. Anything you mark "none" has no role at all: name the firearm, its calibre and its section, and stop.`;
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
    /**
     * The held firearms we supplied NO role for.
     *
     * ⚠️ THE ONE FACT THAT MAKES RULE 12 CHECKABLE. "Do not invent a role" is
     * unverifiable from the paragraph alone — any sentence about a firearm
     * could be a role or could be a description. It is verifiable against what
     * we HANDED OVER: a live generation off the operator's own vault gave all
     * five of his firearms a purpose ("dedicated to backup use and close
     * protection", "for precision long-range shooting") and not one of them
     * had a primary_use on file. Each entry is the firearm as the arsenal
     * names it; the check is that the model did not claim a source for it.
     */
    roleless?: readonly string[];
    /**
     * Did we supply an association's printed exercise rule?
     *
     * ⚠️ FALSE IS THE STATE THE PLATFORM IS ACTUALLY IN, and it is what makes
     * the check below meaningful rather than decorative. `association-
     * activities.ts` (brief §5.5a) does not exist yet, so nothing in the input
     * says which exercises exist, what they are shot with, or what their entry
     * rules are — and a paragraph asserting one is asserting something the pack
     * cannot prove.
     */
    hasActivityRules?: boolean;
    /**
     * Every section number the paragraph may name — "15", "16", "16A".
     *
     * ⚠️ THE SECTIONS WE ACTUALLY READ OFF CARDS, PLUS THE ONE BEING APPLIED
     * FOR. The closing sentence legitimately names the application's own
     * section; every other mention is a claim about a firearm the applicant
     * already holds, and it must come from that firearm's licence card.
     */
    knownSections?: readonly string[];
    /**
     * The section this application itself is lodged under — "16".
     *
     * ⚠️ TOLD APART FROM THE CARD SECTIONS ON PURPOSE. It is always legitimate
     * in the closing sentence and is never evidence about a held firearm, so
     * the "at most once" rule above has to be able to subtract it.
     */
    appliedSection?: string;
  },
): ReasonRejection[] {
  const bad: ReasonRejection[] = [];
  const words = countWords(r.paragraph);

  if (words < REASON_MIN_WORDS || words > REASON_MAX_WORDS) {
    bad.push(`paragraph is ${words} words, outside ${REASON_MIN_WORDS}-${REASON_MAX_WORDS}`);
  }
  /**
   * ⚠️ THE MODEL'S OWN COUNT IS NOT A SAFETY PROPERTY, AND REJECTING ON IT
   * COST THE APPLICANT A GOOD PARAGRAPH. Two live generations in a row came
   * back claiming 218 words for paragraphs of 176 and 196 — counting words is
   * a known weakness of something that thinks in tokens. The length rule is
   * already enforced above against a real count; whether the model can also do
   * the arithmetic is our problem, not the applicant's. It is corrected and
   * logged, never thrown away.
   */
  if (r.wordCount !== words) r.wordCount = words;
  /**
   * ⚠️ THE SAME LIST THE PROMPT SHOWED, NOT THE FULL ONE. Hiding an angle from
   * the prompt and then accepting it back is how a model's memory of an
   * earlier draft reaches the applicant: `exercise_eligibility` without an
   * association rule is a case the paragraph cannot make, and every sentence
   * it would need is refused by rule 16 anyway.
   */
  if (!anglesFor(ctx.licenceType, !!ctx.hasActivityRules).includes(r.angle)) {
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
  /**
   * ⚠️ EVERY SPORTING AND HUNTING SECTION, NOT JUST THE HUNTING ONES, AND THE
   * WHOLE DEFENCE VOCABULARY RATHER THAN ONE WORD OF IT. This checked
   * "self-defence" on the two hunting types and nothing at all on section 16
   * sport — which is precisely the paragraph that came back describing the
   * operator's section 16 CZ as "dedicated to backup use and close
   * protection". A section 15 or 16 firearm used for protection is a firearm
   * used outside its licence, and saying so in the applicant's own motivation
   * is a refusal on its own. There is nothing to defend in a sporting
   * motivation, so these words have no legitimate use in one.
   */
  if (SPORTING_TYPES.includes(ctx.licenceType)) {
    for (const w of DEFENCE_WORDS) {
      if (has(w)) bad.push(`a section 15/16 reason says "${w}"`);
    }
  }

  /**
   * ⚠️ PRODUCT-PAGE VOCABULARY, WHICH IS WHAT THE MODEL REACHES FOR UNPROMPTED.
   * Every one of these came off a single live generation: "this specific
   * platform", "meets the power factor floor efficiently", "rapid split
   * times", "high-volume practice", "dynamic sport shooting", "to participate
   * competitively". It is the register of a catalogue, and a DFO reading
   * hundreds of these can tell it from an applicant's own words.
   */
  for (const w of PRODUCT_PAGE_WORDS) {
    if (has(w)) {
      bad.push(`paragraph says "${w}", which reads like a product page`);
    }
  }

  /**
   * ⚠️ RULE 8 HAS FORBIDDEN AMERICANISMS SINCE THE FIRST DRAFT AND NOTHING
   * ENFORCED IT. The generation that passed every other check wrote
   * "authorized", "utilized" and "recognized" in a document lodged with the
   * South African Police Service under an Act that spells it "licence". A DFO
   * notices, and what they notice is that somebody else wrote it.
   */
  for (const w of AMERICANISMS) {
    if (has(w)) bad.push(`paragraph says "${w}" — South African English`);
  }

  /**
   * ⚠️ A DIVISION THAT DOES NOT EXIST HERE IS WORSE THAN A VAGUE ONE. "Carry
   * Optics" is a USPSA division; an applicant claiming to shoot it in South
   * Africa has said something any reviewer who shoots can see is untrue. The
   * list is what to CATCH, not what is allowed — a division missing from it is
   * simply not checked, which is the safe direction to be incomplete in.
   */
  for (const d of NOT_SOUTH_AFRICAN_DIVISIONS) {
    if (has(d)) {
      bad.push(`paragraph names "${d}", which is not shot in South Africa`);
    }
  }

  /**
   * ⚠️ A RULE WE CANNOT SHOW THE REVIEWER. The first generation under the new
   * prompt wrote that the applicant's CZ "is restricted to pocket pistol events
   * and cannot meet the chambering and capacity requirements for standard
   * semi-automatic handgun disciplines", and that the Glock's chambering "meets
   * the entry criteria for practical handgun shooting exercises up to twenty
   * five metres". Every one of those is plausible, probably true, and supported
   * by NOTHING in the pack — no exercise list, no equipment rule, no distance.
   *
   * ⚠️ WHICH IS WORSE THAN VAGUENESS, NOT BETTER. A DFO who shoots can check a
   * claimed entry criterion, and an applicant who cannot produce the rule they
   * quoted has damaged their own application. The gap rests on type and section
   * — "none of my rifles can be used in a handgun exercise" — until
   * association-activities.ts can supply the rule and the pack can annex it.
   */
  if (!ctx.hasActivityRules) {
    for (const w of UNPROVABLE_RULE_WORDS) {
      if (has(w)) {
        bad.push(
          `paragraph claims "${w}" with no association rule supplied to prove it`,
        );
      }
    }
    /**
     * ⚠️ AND A DISTANCE IS A RULE. "up to twenty five metres" reads as the
     * exercise's own specification. Hunting range bands are different — they
     * come out of REASON_BANKS, which IS supplied — so the check is skipped
     * whenever a supplied term already carries a distance.
     */
    const suppliedDistance = /\d+\s*(?:m\b|metres|meters)/i.test(
      ctx.knownTerms.join(' '),
    );
    if (!suppliedDistance && /\d+\s*(?:m\b|metres|meters)/i.test(r.paragraph)) {
      bad.push('paragraph states a distance nothing supplied supports');
    }
  }

  /**
   * ⚠️ A SECTION NOBODY GAVE US, WHICH IS THE SAME CRIME AS AN INVENTED ROLE
   * AND WAS WRITTEN INTO THE PROMPT BY HAND. The arsenal carried no sections
   * at all, and rule 11 told the model to name one for every held firearm — so
   * it took the section of the APPLICATION and produced "all licensed under
   * section 16" over a battery in which the operator's Howa 6.5mm Creedmoor is
   * section 15. A wrong section tells the Registrar the applicant does not
   * know what their own licences say.
   *
   * ⚠️ THE TEST IS AGAINST WHAT WE SUPPLIED, not against the paragraph's
   * grammar. `ctx.knownSections` is every section clause the input actually
   * carried; a paragraph naming one that is not in it is naming one nobody
   * read off a card. An empty list means we supplied none, so any section
   * claim about a held firearm is invented — and the applied-for section is
   * legitimate in the closing sentence, which is why it is passed in too.
   */
  const mentioned = [
    ...r.paragraph.matchAll(/\bsections?\s+(\d{1,2}A?)\b/gi),
  ].map((m) => m[1].toUpperCase());
  for (const n of mentioned) {
    if (!(ctx.knownSections ?? []).includes(n)) {
      bad.push(
        `paragraph says "section ${n}", which nothing we supplied says a firearm is licensed under`,
      );
    }
  }

  /**
   * ⚠️ AND NAMING THE RIGHT NUMBER IS NOT THE SAME AS BEING ENTITLED TO NAME
   * IT. "all licensed under section 16" passes the check above whenever the
   * APPLICATION is a section 16 — which is exactly the sentence the operator
   * caught, over a battery whose Howa 6.5mm Creedmoor is section 15.
   *
   * So when we supplied no firearm sections at all, the paragraph may mention
   * a section AT MOST ONCE: the closing statutory sentence, "applying under
   * section 16 as a dedicated sport shooter". A second mention is the
   * paragraph describing firearms it was told nothing about.
   *
   * ⚠️ IT RELAXES ON ITS OWN. The moment ownedFirearmSections can read a card,
   * that firearm's section is in `knownSections` and this rule stops applying —
   * which is the correct shape: the constraint exists because of what we do not
   * know, not because of what the paragraph is allowed to say.
   */
  const suppliedFirearmSections = (ctx.knownSections ?? []).filter(
    (n) => n !== ctx.appliedSection,
  );
  if (!suppliedFirearmSections.length && mentioned.length > 1) {
    bad.push(
      'paragraph gives held firearms a section, and no licence card supplied one',
    );
  }

  /**
   * ⚠️ A ROLE NOBODY GAVE US. See ctx.roleless: the model was handed these
   * firearms with no primary_use, no previous motivation and no endorsement,
   * so any source it claims for one of them is invented — and an invented role
   * reads as fact on a document the applicant signs. "none" is the correct
   * answer and passes; anything else is refused, because the paragraph was
   * written from it.
   */
  const roleless = new Set(ctx.roleless ?? []);
  for (const entry of r.existingRoles) {
    if (entry.source === 'none' || !roleless.size) continue;
    const match = bestFirearmMatch(entry.firearm, ctx.knownFirearms);
    if (!match || !roleless.has(match)) continue;
    bad.push(
      `claims a "${entry.source}" role for ${entry.firearm}, which nothing on file gives a use for`,
    );
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

  /**
   * ⚠️ TOKEN OVERLAP, NOT WHOLE-STRING CONTAINMENT. The first version asked
   * whether the label was a substring of something we supplied, and refused
   * "IPSC Production Division" against a bank line reading "IPSC Handgun:
   * Production (no optic, list handguns)" — the same discipline, phrased the
   * way a shooter would say it. Seen on the first live generation.
   *
   * What the rule is actually for is catching an example invented out of
   * nothing: "IDPA Stock Service Pistol" fails this, correctly, because IDPA
   * appears nowhere in what we gave the model. Every significant word has to
   * come from somewhere we supplied; the arrangement is the model's business.
   */
  /**
   * ⚠️ AN EXAMPLE IS DROPPED, NEVER FATAL — THE PARAGRAPH IS THE PRODUCT.
   * Rejecting a whole generation because a label said "SAPSA Provincial
   * Matches" and the word "matches" was not in the supplied terms is a
   * disproportionate answer to a cosmetic problem: the paragraph is what the
   * applicant signs, and it is already checked for invented firearms, banned
   * reasons and the wrong section.
   *
   * ⚠️ AND THE TEST IS ACRONYMS ONLY. What this guards against is an example
   * naming a BODY OR DISCIPLINE WE NEVER MENTIONED — "IDPA Stock Service
   * Pistol" against a member who shoots IPSC. In practice that failure is
   * always an acronym; ordinary words are how a person writes, and demanding
   * every one of them be quoted back from the input refuses correct answers.
   */
  const haystack = ctx.knownTerms.join(' ').toUpperCase();
  r.examples = r.examples.filter((ex) => {
    const unknown = ex.label
      .split(/[^A-Za-z0-9]+/)
      .filter((t) => t.length >= 3 && t === t.toUpperCase() && /[A-Z]/.test(t))
      .filter((t) => !haystack.includes(t));
    return unknown.length === 0;
  });

  return bad;
}

/**
 * A firearm's name, as a person would write it in a sentence.
 *
 * ⚠️ THE CARD SHOUTS AND THE PARAGRAPH MUST NOT. A licence card prints
 * "MAUSER", ".30-06 SPRINGFIELD", "9MM PAR ( 9X19MM )", and the vault stores
 * that verbatim on purpose — the confirm panel asks the member to check it
 * against the card in their hand, and a card reading "S/L RIFLE" must still
 * read "S/L RIFLE" when they do. But rule 13 tells the model to spell a make
 * exactly as the input spells it, so the first generation under these rules
 * produced "a NORDISKE PRECISION 223 REM rifle licensed under section 16" in
 * the middle of an English sentence.
 *
 * ⚠️ SO IT IS FIXED AT THE PROSE BOUNDARY, NOT AT THE SOURCE. Same discipline
 * as `answerValue()` and the card's "NONE": the stored value never changes,
 * and the one reader that renders prose does the tidying. Nothing else in the
 * system sees this.
 *
 * ⚠️ FOUR LETTERS OR MORE, WHICH IS WHY "CZ", "FN", "ADP" AND "REM" SURVIVE.
 * A three-letter all-caps token in this trade is nearly always an initialism a
 * person also writes in capitals; a six-letter one nearly never is. Being
 * incomplete in that direction leaves a name as the card had it, which is
 * merely shouty. Being wrong in the other direction renames a manufacturer.
 */
export function proseFirearmName(raw: string): string {
  return (raw ?? '')
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token;
      // Strip leading punctuation for the tests — ".30-06" is a digit token.
      const core = token.replace(/^[^A-Za-z0-9]+/, '');
      const hasDigit = /[0-9]/.test(core);
      const startsDigit = /^[0-9]/.test(core);
      // ⚠️ A MODEL DESIGNATION IS LEFT ALONE. "T3X", "P-10", "SP-01" and
      // "AR-15" begin with a letter and carry a digit; lower-casing them would
      // print a firearm nobody sells.
      if (hasDigit && !startsDigit) return token;
      // A calibre: "9MM" → "9mm", "9X19MM" → "9x19mm", ".30-06" unchanged.
      if (startsDigit) return token.toLowerCase();
      if (!/^[A-Z]+$/.test(core) || core.length < 4) return token;
      return token.replace(
        /[A-Z]+/,
        (w) => w[0] + w.slice(1).toLowerCase(),
      );
    })
    .join('')
    // The card's own bracket spacing: "( 9x19mm )" is not how anybody writes.
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The sections whose firearms are sporting, and never defensive. */
const SPORTING_TYPES: readonly MotivationLicenceType[] = [
  MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  MotivationLicenceType.S16_DEDICATED_HUNTER,
  MotivationLicenceType.S16_DEDICATED_SPORT,
];

/**
 * The defence vocabulary, banned outright in a sporting motivation.
 *
 * ⚠️ "protection" AND NOT "protect", because "protected species" is a
 * legitimate phrase in a hunting motivation and a substring test would refuse
 * it. The rule is about a firearm's USE, not about the word.
 */
export const DEFENCE_WORDS = [
  'self-defence',
  'self defence',
  'protection',
  'backup',
  'back-up',
  'home defence',
  'concealed',
  'close protection',
] as const;

/**
 * The register of a catalogue, which is not the register of an applicant.
 *
 * ⚠️ WORD-BOUNDARY MATCHES, WHICH IS WHY "competitively" AND "dynamic" ARE
 * SAFE TO BAN. `has()` anchors at the start of a word only, so "competitively"
 * does not catch "competition" and "dynamic" does not catch a legitimate
 * sentence about competing — but it DOES catch "dynamics", which is a price
 * worth paying: a reason paragraph has no business discussing recoil dynamics
 * either.
 */
export const PRODUCT_PAGE_WORDS = [
  'power factor',
  'split times',
  'high-volume',
  'high volume',
  'platform',
  'tactical',
  'engage targets',
  'dynamic',
  'competitively',
  'efficiently',
] as const;

/**
 * Words that assert an exercise's rules.
 *
 * ⚠️ NOT BANNED OUTRIGHT — BANNED WHILE WE CANNOT SHOW THE RULE. Once
 * `association_activities[]` carries "only 9mmP pistols and larger" with a
 * source and the pack annexes it, "requirement" is exactly the right word and
 * quoting it is the strongest thing the paragraph can do.
 *
 * ⚠️ "restricted to" AND NOT "restricted", because a legitimate sentence can
 * say a range is restricted. This list is about a claim, not a word.
 */
export const UNPROVABLE_RULE_WORDS = [
  'requirement',
  'criteria',
  'criterion',
  'eligib',
  'restricted to',
  'capacity requirement',
  'minimum calibre',
  'entry rule',
] as const;

/**
 * Spellings that are not South African.
 *
 * ⚠️ THE UNAMBIGUOUS ONES ONLY. "licence" is the noun and "license" the verb in
 * both registers, so "licensed under section 16" — which is the correct and
 * commonest phrase in this paragraph — must never trip. These are matched at a
 * word boundary, so the stem catches every inflection: "authoriz" takes
 * authorize, authorized and authorization.
 */
export const AMERICANISMS = [
  'caliber',
  'defense',
  'offense',
  'meters',
  'authoriz',
  'utiliz',
  'recogniz',
  'organiz',
  'analyz',
  'specializ',
  'maximiz',
  'minimiz',
  // The corpus's own word is "programme" — the association's shooting
  // programme, which is what the packs annex.
  'program ',
] as const;

/**
 * Divisions that exist elsewhere and not here.
 *
 * ⚠️ WHAT TO CATCH, NOT WHAT IS ALLOWED. South African shooting bodies name
 * their own divisions and the input carries them; this only stops the model
 * reaching for an American one from memory.
 */
export const NOT_SOUTH_AFRICAN_DIVISIONS = [
  'Carry Optics',
  'Limited 10',
  'Stock Service Pistol',
  'Carry Optics Division',
] as const;

/**
 * Which firearm in the battery is this string about?
 *
 * ⚠️ AN ARGMAX ACROSS THE WHOLE BATTERY, NOT A YES/NO AGAINST ONE ENTRY, and
 * the difference is a false accusation. A first version asked "does this name
 * overlap a roleless firearm by two tokens", and a battery holding a CZ P-10 C
 * (roleless) beside a CZ Shadow 2 (with a stated use) made every sentence
 * about the Shadow trip it: "cz" and "9mm" are two tokens, and both handguns
 * have them. A make and a calibre do not identify a firearm — several in one
 * battery share both — so the only sound question is which entry fits BEST.
 *
 * ⚠️ AND A TIE IS NOT A MATCH. Two firearms scoring the same means we cannot
 * tell which one the model meant, and refusing a generation on a guess costs
 * the applicant a paragraph they would have signed.
 *
 * ⚠️ TOKENS, BECAUSE THE MODEL RE-SPELLS THINGS. The arsenal supplies "Howa
 * 6.5 Creedmoor"; the model returns "my Howa rifle in 6.5 Creedmoor".
 * Demanding the strings match lets every invented role through on a
 * paraphrase, which is the failure this exists to catch.
 */
export function bestFirearmMatch(
  named: string,
  battery: readonly string[],
): string | null {
  const tokens = (v: string) =>
    new Set(
      v
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter((t) => t.length > 1 && !FIREARM_NOISE.has(t)),
    );
  const want = tokens(named);
  if (!want.size) return null;

  let best: string | null = null;
  let bestScore = 0;
  let tied = false;
  for (const candidate of battery) {
    const have = tokens(candidate);
    let score = 0;
    for (const t of want) if (have.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return bestScore > 0 && !tied ? best : null;
}

/** Words that name no firearm and would match everything. */
const FIREARM_NOISE = new Set([
  'my',
  'the',
  'and',
  'in',
  'a',
  'an',
  'handgun',
  'pistol',
  'rifle',
  'shotgun',
  'carbine',
  'firearm',
]);

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
