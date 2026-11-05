import RULEBOOKS from './associations/association-rules.json';

// ────────────────────────────────────────────────────────────────────
// THE ASSOCIATION'S OWN RULEBOOK, AS THE PACK PRINTS IT.
//
// ⚠️ WHY THIS EXISTS. A professional Section 16 sport motivation is 21-38
// pages, and 12-23 of those pages are the shooter's association rulebook
// quoted VERBATIM — NHSA's exercise rules, FOSA's disciplines — followed by one
// paragraph saying the applicant shoots that exercise. A DFO checks the rule
// against the pack; a generated summary is worth nothing to them and reads as
// padding. So the text here is the published text, captured on the date the
// index records, never paraphrased.
//
// ⚠️ AND IT IS STATIC. It is not the writer's job, it is not per-applicant, and
// it must not be regenerated: the moment a model rewords an exercise rule the
// one thing that made it useful is gone.
//
// The raw captures live in backend/data/association-rules/ (gitignored, the
// same rule as the C.I.P. sheets). This module reads the index that IS in the
// repo, so the pack is reproducible without the capture directory.
// ────────────────────────────────────────────────────────────────────

export type AssociationSlug = 'nhsa' | 'fosa';

/** What a firearm type means to an exercise list. */
export type FirearmFamily = 'handgun' | 'rifle' | 'shotgun' | 'any';

export interface AssociationExercise {
  /** C.I.P.-style code where the association publishes one (Com21). */
  code: string | null;
  title: string;
  appliesTo: FirearmFamily;
  /** The published rule, verbatim. */
  text: string;
}

export interface AssociationRulebook {
  name: string;
  sourceUrl: string;
  fetchedOn: string;
  note?: string;
  exercises: AssociationExercise[];
}

const RULEBOOK_INDEX = RULEBOOKS as unknown as Record<
  string,
  AssociationRulebook
>;

export interface Association {
  slug: AssociationSlug;
  name: string;
  /** Names members actually type, matched case-insensitively. */
  aliases: readonly string[];
}

export const ASSOCIATIONS: readonly Association[] = [
  {
    slug: 'nhsa',
    name: 'Natshoot (NHSA)',
    aliases: [
      'nhsa',
      'natshoot',
      'natshoot nhsa',
      'national hunting and shooting',
      'sa hunters natshoot',
      'natshoot (nhsa)',
    ],
  },
  {
    slug: 'fosa',
    name: 'Firearms Owners South Africa (FOSA)',
    aliases: [
      'fosa',
      'firearms owners south africa',
      'firearms owners association',
      'firearm owners south africa',
    ],
  },
];

/** The whole index, for a caller that wants to list everything. */
export function rulebooks(): Record<string, AssociationRulebook> {
  return RULEBOOK_INDEX;
}

/**
 * The slug for whatever the applicant typed, or null.
 *
 * ⚠️ MATCHED ON THE ALIAS LIST, NOT ON EQUALITY. Members type "Natshoot",
 * "NHSA", "Natshoot NHSA" and the association's full name interchangeably.
 */
export function resolveAssociation(
  input: string | undefined | null,
): AssociationSlug | null {
  const printed = (input ?? '').trim().toLowerCase();
  if (!printed) return null;
  for (const association of ASSOCIATIONS) {
    if (printed === association.name.toLowerCase()) return association.slug;
    if (association.aliases.some((alias) => printed.includes(alias))) {
      return association.slug;
    }
  }
  return null;
}

/** "Shotgun" → 'shotgun'; "Combination" fires both, so the list stays open. */
export function firearmFamily(
  firearmType: string | undefined | null,
): FirearmFamily {
  const printed = (firearmType ?? '').trim().toLowerCase();
  if (/shotgun/.test(printed)) return 'shotgun';
  if (/handgun|pistol|revolver/.test(printed)) return 'handgun';
  if (/rifle|carbine/.test(printed)) return 'rifle';
  return 'any';
}

/**
 * The exercises that fit this firearm, for the interview's choice list.
 *
 * A slug that is not in the index returns an empty list rather than throwing:
 * an association we hold no rulebook for is a missing feature, not a crash.
 */
export function exercisesFor(
  association: AssociationSlug | string | null | undefined,
  firearmType?: string | null,
): AssociationExercise[] {
  const slug =
    typeof association === 'string'
      ? (resolveAssociation(association) ?? (association as AssociationSlug))
      : null;
  const book = slug ? RULEBOOK_INDEX[slug] : undefined;
  if (!book) return [];
  const family = firearmFamily(firearmType);
  if (family === 'any') return [...book.exercises];
  return book.exercises.filter(
    (exercise) => exercise.appliesTo === family || exercise.appliesTo === 'any',
  );
}

export interface ResolvedRule {
  association: AssociationSlug;
  associationName: string;
  sourceUrl: string;
  code: string | null;
  title: string;
  text: string;
}

/** One exercise, verbatim, ready for the pack's appendix. */
export function rulesFor(
  association: AssociationSlug | string | null | undefined,
  code: string,
): ResolvedRule | null {
  const slug =
    typeof association === 'string'
      ? (resolveAssociation(association) ?? (association as AssociationSlug))
      : null;
  if (!slug) return null;
  const book = RULEBOOK_INDEX[slug];
  if (!book) return null;
  const wanted = code.trim().toLowerCase();
  const exercise = book.exercises.find(
    (entry) =>
      (entry.code ?? '').toLowerCase() === wanted ||
      entry.title.toLowerCase() === wanted,
  );
  if (!exercise) return null;
  return {
    association: slug,
    associationName: book.name,
    sourceUrl: book.sourceUrl,
    code: exercise.code,
    title: exercise.title,
    text: exercise.text,
  };
}

/**
 * What the applicant's answers could reach: the association they named and the
 * exercises that fit the firearm they are applying for.
 *
 * ⚠️ NO ASSOCIATION NAMED IS A NORMAL STATE, not an error: the interview asks
 * for it, and until it is answered the pack simply has no appendix to print.
 */
/**
 * The rulebook for the exercise the applicant named, from whichever of their
 * memberships resolves first.
 *
 * ⚠️ NOTHING NAMED IS A NORMAL STATE. No association, or an association whose
 * exercise list the applicant has not answered yet, simply has no appendix —
 * the pack prints without it rather than with a heading and no rules.
 */
export function rulebookForAnswers(
  answers: Record<string, string>,
): ResolvedRule | null {
  const exercise = (answers.discipline_exercise ?? '').trim();
  if (!exercise) return null;
  for (const name of [
    answers.association_name,
    answers.association_2_name,
    answers.association_3_name,
  ]) {
    const association = resolveAssociation(name ?? '');
    if (!association) continue;
    const rule = rulesFor(association, exercise);
    if (rule) return rule;
  }
  return null;
}

export function rulebookCandidates(answers: Record<string, string>): {
  association: AssociationSlug | null;
  exercises: AssociationExercise[];
} {
  const association = resolveAssociation(
    answers.association_name ?? answers.association ?? '',
  );
  if (!association) return { association: null, exercises: [] };
  return {
    association,
    exercises: exercisesFor(association, answers.firearm_type),
  };
}
