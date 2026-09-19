import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHAT AN ACCREDITED ASSOCIATION ACTUALLY RUNS, AND THE RULE FOR EACH.
//
// ⚠️ THIS IS THE FILE THE WHOLE `exercise_eligibility` ANGLE RESTS ON.
//
// Operator, via MOTIVATION-CORPUS-LEARNINGS.md §4, on the approved packs: "The
// NHSA handgun example lists every postal exercise with its equipment rule …
// That is a verifiable, document-backed gap between two handguns, and it is
// stronger than any calibre opinion."
//
// The argument it buys is this one, and it is the strongest sentence an
// approved motivation on file contains:
//
//   "The association's 7 m 2x5 exercise is open only to 9mmP pistols and
//    larger; my 6.35 mm CZ shoots the 5 m pocket-pistol exercise and cannot
//    enter it."
//
// ⚠️ AND IT IS THE ONLY KIND OF CLAIM THIS FILE EXISTS TO MAKE POSSIBLE.
// `motivation-reason.ts` refuses the paragraph outright when this list is empty
// — "YOU MAY NOT STATE A RULE NOBODY GAVE YOU" — because the first generation
// under the new prompt asserted entry criteria, distances and capacity
// requirements that nothing in the pack could support. A DFO who shoots can
// check a claimed rule, and an applicant who cannot produce the rule they
// quoted has damaged their own application. So a rule reaches the page only by
// being transcribed here, with its source, and being annexed to the pack.
//
// ⚠️ SO NOTHING IS ADDED FROM MEMORY. Every entry below is transcribed from a
// source named on the entry itself. An association with no entry returns an
// empty list, `hasActivityRules` stays false, the angle stays withheld, and the
// document behaves exactly as it did before this file existed. That is the
// safety property: adding an association can only ever ADD a provable argument,
// never a plausible one.
//
// ⚠️ SEEDED, NOT FINISHED — THE OPERATOR REVIEWS BEFORE THIS SHIPS.
// Brief §5.5a: seed NHSA from natshoot.co.za's postal-shooting pages and
// SAHGCA from sahunters.co.za, "operator reviews before it ships". The four
// handgun entries below are the ones the operator transcribed into
// MOTIVATION-CORPUS-LEARNINGS.md from a real NHSA example pack; they have NOT
// been re-verified against the association's own site. Verify the wording, then
// add the rifle, shotgun and hunting exercises the same way. `verifiedAt` is
// the date of the SOURCE, not the date it was typed in.
//
// ⚠️ THE OTHER HALF OF §5.5a IS NOT BUILT: THE ANNEXURE. "The pack binds the
// rules of the exercises the reason names as an annexure, in the association's
// words with a source line." That needs (a) an `exercise` kind on the reason's
// `examples` so the named exercises survive the call, (b) a generated annexure
// id beside SELLER_CONSENT, and (c) a renderer — and (b) takes a letter, so it
// shifts every annexure after it and every contents page number. Until then the
// rule is quoted in the reason paragraph but the pack cannot produce the paper
// it points at, which is weaker than the approved packs. This file is still
// worth having: the rule is at least TRUE and sourced, where before the model
// asserted one from memory and the validator refused it.
// ────────────────────────────────────────────────────────────────────

/**
 * Which dedicated status an exercise counts toward.
 *
 * ⚠️ AN EXERCISE IS NOT NEUTRAL ABOUT THIS. A hunter's association counts a
 * hunting-derived exercise; a sport-shooting body counts a match. Naming a
 * sport exercise on a dedicated-hunter application is a sentence about a
 * discipline the applicant never claimed.
 */
export type ActivityStatus = 'hunter' | 'sport';

export interface AssociationActivity {
  /** The association's name as the applicant's own answer spells it. */
  association: string;
  /**
   * The SAPS accreditation number this exercise is run under, where the
   * association holds one per discipline.
   *
   * ⚠️ EMPTY IS HONEST, NOT A GAP TO FILL WITH A GUESS. SAHGCA holds 400001
   * for hunting and 1300091 for sport (brief §5.5a); where a number is not
   * known the entry is matched on the association name alone. A wrong
   * accreditation number on an annexure is worse than none.
   */
  accreditation: string;
  /** The exercise's own name, as the association prints it. */
  name: string;
  /** The distance it is shot at, as printed. Empty where the exercise is not. */
  distance: string;
  /** The class of firearm it is shot with, in the association's words. */
  firearmClass: string;
  /**
   * ⚠️ THE RULE, AND THE WHOLE REASON THIS FILE EXISTS. Verbatim where the
   * source prints it verbatim — a calibre floor or ceiling, a barrel length, an
   * action, a box-to-fit. This string is what the reason generator quotes and
   * what the pack annexes, so it must be the association's own words and not a
   * summary of them.
   */
  rule: string;
  status: ActivityStatus;
  /** Where it came from, named so the operator can check it. */
  source: string;
  /** The date of the SOURCE, not of the transcription. */
  verifiedAt: string;
}

/**
 * The seed. One entry per exercise, with the rule the association prints.
 *
 * ⚠️ NHSA HANDGUN ONLY, SO FAR. These four are the exercises the operator
 * transcribed from a real NHSA example pack (MOTIVATION-CORPUS-LEARNINGS.md §4,
 * dated 2026-09-07). The rifle, shotgun, hunting and SAHGCA sets are not here
 * yet, and an absent exercise is simply never offered — see the banner.
 */
const ACTIVITIES: readonly AssociationActivity[] = [
  {
    association: 'NHSA',
    accreditation: '',
    name: '5 m Snubby and Pocket Pistol',
    distance: '5 m',
    firearmClass: 'Handgun',
    rule: 'barrel not longer than 100 mm',
    status: 'sport',
    source:
      'NHSA postal exercise list (Example-motivation-or-Sport-handgun.docx)',
    verifiedAt: '2026-09-07',
  },
  {
    association: 'NHSA',
    accreditation: '',
    name: '7 m 2x5 shot',
    distance: '7 m',
    firearmClass: 'Handgun',
    rule: 'only 9mmP pistols and larger',
    status: 'sport',
    source:
      'NHSA postal exercise list (Example-motivation-or-Sport-handgun.docx)',
    verifiedAt: '2026-09-07',
  },
  {
    association: 'NHSA',
    accreditation: '',
    name: '10 m centre-fire',
    distance: '10 m',
    firearmClass: 'Handgun',
    rule: 'all calibres',
    status: 'sport',
    source:
      'NHSA postal exercise list (Example-motivation-or-Sport-handgun.docx)',
    verifiedAt: '2026-09-07',
  },
  {
    association: 'NHSA',
    accreditation: '',
    name: '50 m Hunting Handgun',
    distance: '50 m',
    firearmClass: 'Handgun',
    rule: 'min .357 Mag, 4-inch barrel',
    status: 'hunter',
    source:
      'NHSA postal exercise list (Example-motivation-or-Sport-handgun.docx)',
    verifiedAt: '2026-09-07',
  },
];

/**
 * How many exercises reach the model at once.
 *
 * ⚠️ A CAP, BECAUSE THIS RIDES INSIDE THE REASON CALL'S JSON. The whole input
 * is `JSON.stringify`d into one message; an association with forty exercises
 * would crowd out the arsenal and the research, which are what the paragraph is
 * actually about. Eight is enough for the model to find the one rule that
 * separates the applied-for firearm from a held one.
 */
const MAX_OFFERED = 8;

/**
 * Every name one association is known by.
 *
 * ⚠️ AN EXPLICIT LIST, NOT A CONTAINMENT TEST, AND THE DIFFERENCE IS A FALSE
 * POSITIVE. "Natshoot", "NHSA" and the spelled-out name are one body and the
 * applicant types whichever they know — but matching on substring folds
 * "Not The N H S A Body" onto NHSA as well, and the pack would then annex and
 * quote a rule belonging to an association the applicant is not a member of.
 * Attaching the wrong association's rules to a signed document is the exact
 * failure this file exists to prevent, so the names are enumerated instead of
 * guessed at.
 */
const ASSOCIATION_ALIASES: Record<string, readonly string[]> = {
  NHSA: [
    'NHSA',
    'Natshoot',
    'Natshoot NHSA',
    'National Hunting and Shooting Association',
  ],
};

/** Fold a name or number to something comparable. */
function norm(v: string): string {
  return (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Whether the applicant's typed name is one of this association's own names. */
function nameMatches(association: string, typed: string): boolean {
  const want = norm(typed);
  if (!want) return false;
  const aliases = ASSOCIATION_ALIASES[association] ?? [association];
  return aliases.some((a) => norm(a) === want);
}

/**
 * The exercises an association runs, for the model to argue from.
 *
 * ⚠️ MATCHED ON THE ACCREDITATION NUMBER WHERE THERE IS ONE, AND ON THE NAME
 * OTHERWISE. The applicant types their association's name by hand — "Natshoot",
 * "NHSA", "National Hunting and Shooting Association" are one body — so the
 * name test is a containment test on the folded strings rather than equality.
 * An association we hold nothing for returns `[]`, which is the state the whole
 * codebase is in today.
 *
 * @param args.status  Prefer exercises counting toward this status; they are
 *   ordered first rather than filtered out, because an association's hunting
 *   and sport exercises are often the same shoot and the model chooses the
 *   angle.
 */
export function activitiesFor(args: {
  association?: string;
  accreditation?: string;
  status?: ActivityStatus;
}): AssociationActivity[] {
  const name = norm(args.association ?? '');
  const accreditation = norm(args.accreditation ?? '');
  if (!name && !accreditation) return [];

  const matched = ACTIVITIES.filter((a) => {
    if (
      accreditation &&
      a.accreditation &&
      norm(a.accreditation) === accreditation
    ) {
      return true;
    }
    if (!args.association) return false;
    return nameMatches(a.association, args.association);
  });

  // Preferred status first, then the source order, then the cap.
  const ordered = args.status
    ? [
        ...matched.filter((a) => a.status === args.status),
        ...matched.filter((a) => a.status !== args.status),
      ]
    : matched;

  return ordered.slice(0, MAX_OFFERED);
}

/**
 * The exercises as the reason call receives them.
 *
 * ⚠️ SNAKE_CASE KEYS, LIKE EVERY OTHER FIELD IN THAT INPUT. The whole object is
 * serialised straight into the model's message, and a camelCase key in a block
 * of snake_case ones reads as a different kind of thing.
 */
export function activitiesBlock(
  activities: readonly AssociationActivity[],
): Record<string, string>[] {
  return activities.map((a) => ({
    association: a.association,
    exercise: a.name,
    distance: a.distance,
    firearm_class: a.firearmClass,
    eligibility_rule: a.rule,
    counts_toward: a.status,
    source: a.source,
  }));
}

/**
 * Every string the exercise list puts in front of the model.
 *
 * ⚠️ THIS IS WHAT LETS THE PARAGRAPH QUOTE A DISTANCE. `validateReason` refuses
 * a distance "nothing supplied supports" unless a supplied term already carries
 * one — and it reads that from `knownTerms`. Without these lines the rule the
 * model was just given would be refused the moment it used it.
 */
export function activityTerms(
  activities: readonly AssociationActivity[],
): string[] {
  return activities.flatMap((a) => [
    a.association,
    a.name,
    a.distance,
    a.firearmClass,
    a.rule,
  ]);
}

/**
 * Whether this licence type argues from exercises at all.
 *
 * ⚠️ IT MIRRORS `REASON_ANGLES`, AND THE TWO MUST AGREE. `exercise_eligibility`
 * is offered to the two dedicated types and to the section 15 that covers both
 * hunter and sports shooter. A self-defence or renewal application has no
 * exercise angle, so handing it an exercise list would be offering material the
 * validator then refuses the paragraph for using.
 */
export function arguesFromExercises(
  licenceType: MotivationLicenceType,
): boolean {
  return (
    licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER ||
    licenceType === MotivationLicenceType.S16_DEDICATED_SPORT ||
    licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER
  );
}

/**
 * The status a licence type is arguing, where it argues one.
 *
 * ⚠️ S15 IS DELIBERATELY UNDEFINED. It is one enum value covering the
 * occasional hunter AND the occasional sports shooter, so ordering its list
 * would pick one of two arguments the applicant never chose. Undefined leaves
 * the source order alone.
 */
export function statusFor(
  licenceType: MotivationLicenceType,
): ActivityStatus | undefined {
  if (licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER)
    return 'hunter';
  if (licenceType === MotivationLicenceType.S16_DEDICATED_SPORT) return 'sport';
  return undefined;
}
