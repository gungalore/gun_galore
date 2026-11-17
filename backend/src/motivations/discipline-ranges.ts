import { rulebookForAnswers } from './association-rules';
import type { CandidateUses } from './firearm-uses.service';

// ────────────────────────────────────────────────────────────────────
// THE PUBLISHED DISTANCES A SPORT DISCIPLINE IS ACTUALLY SHOT AT.
//
// ⚠️ THE DEFECT THIS EXISTS FOR. A sport motivation is written partly from the
// generated "uses" table, which is written for a CLASS of firearm (a .30-06
// bolt rifle, a 9 mm pistol) and lists formats and distances across every
// discipline that class appears in. An applicant who shoots a 20 m handgun
// exercise could be handed "F-Class prone at 600 m" and the writer, told to
// describe the course of fire, had no fact saying otherwise. The ranges in the
// document therefore did not always fit the discipline the applicant named.
//
// ⚠️ THE SOURCE IS THE PUBLISHED RULE, PARSED, NOT RECALLED. The association
// index holds the exercise's own text verbatim ("SHOOTING DISTANCE: … is 10
// metres"); a discipline's requirement paragraph states its range where it has
// one. This module reads those numbers and nothing else — there is no table of
// remembered distances to drift.
//
// ⚠️ NO SPEC IS A REAL ANSWER. An association we hold no rulebook for, or an
// exercise whose rules say "various", has NO distance specification — and the
// writer is then told to write that discipline without a distance rather than
// to reach for the nearest one it remembers.
// ────────────────────────────────────────────────────────────────────

export interface DisciplineRangeSpec {
  /** The exercise or discipline the distances belong to. */
  label: string;
  /** Every distance the published text names, in metres, ascending. */
  values: number[];
  /**
   * True when the text states a BAND ("300 m to 900 m") rather than a list of
   * fixed distances. A band admits the distances inside it; a list admits only
   * its own values, because "100 m, 200 m and 300 m" is three stages, not a
   * continuous course.
   */
  span: boolean;
  /** Where the numbers came from. Always the association's exercise rulebook. */
  source: 'exercise';
}

const NBSP = /[\u00a0\u202f]/g;

/** "1 000" → "1000"; en/em dashes → hyphen; collapse whitespace. */
function normalise(text: string): string {
  return (text ?? '')
    .replace(NBSP, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

/**
 * Every distance a published rule states, in metres.
 *
 * ⚠️ MILLIMETRES ARE NOT DISTANCES. "9 mm" and "6,35 mm" are calibres and
 * dimensions and appear in every one of these texts; reading them as shooting
 * distances would produce a spec of 9 metres for a rifle exercise. They are
 * removed before anything is matched.
 */
export function parseDistances(text: string): {
  values: number[];
  span: boolean;
} {
  const clean = normalise(text)
    /**
     * ⚠️ A TARGET'S SIZE IS NOT A DISTANCE. NHSA's steel-plate exercise prints
     * "maximum 300m (w) x 300mm (h) x 10mm thick" — a typo for 300 mm that our
     * own parser read as a 300 m shooting distance, which would have admitted
     * every range up to 300 m for a 20 m exercise. A number carrying a
     * width/height/thickness tag or joined by "x" to another dimension is a
     * dimension.
     */
    .replace(/\d+(?:[.,]\d+)?\s*m(?:m|etres?|eters?)?\s*(?:\([whb]\)|x\s*\d)/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:mm|millimetres?|millimeters?)\b/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:cm|centimetres?|centimeters?)\b/gi, ' ');
  const values = new Set<number>();
  let span = false;

  const add = (raw: string): void => {
    const n = Number(raw.replace(/\s/g, ''));
    // A 0 m or a 9 999 m "distance" is a parse failure, not a course of fire.
    if (Number.isFinite(n) && n > 0 && n <= 2_000) values.add(n);
  };

  const metres = '(?:metres?|meters?|m)';
  const yards = '(?:yards?|yds?)';
  // "1 000" is how South African English prints four digits; the space is part
  // of the number, not a separator between two of them.
  const num = '(\\d{1,3}(?: \\d{3})*|\\d{1,4})';

  // "300 m to 900 m", "300 to 900 metres", "5 - 50 m"
  //
  // ⚠️ "and" IS NOT A BAND. "Target frames stand at 100 m, 200 m and 300 m" is
  // three fixed distances, not a 200-300 m span; treating the conjunction as a
  // range flattened a list into a band and admitted every distance between.
  for (const m of clean.matchAll(
    new RegExp(
      `${num}\\s*${metres}?\\s*(?:-|to)\\s*${num}\\s*${metres}\\b`,
      'gi',
    ),
  )) {
    add(m[1]);
    add(m[2]);
    span = true;
  }

  // "300 to 1 000 yards" (Bisley's own unit), converted to metres.
  for (const m of clean.matchAll(
    new RegExp(
      `${num}\\s*${yards}?\\s*(?:-|to)\\s*${num}\\s*${yards}\\b`,
      'gi',
    ),
  )) {
    add(String(Math.round(Number(m[1].replace(/ /g, '')) * 0.9144)));
    add(String(Math.round(Number(m[2].replace(/ /g, '')) * 0.9144)));
    span = true;
  }

  for (const m of clean.matchAll(
    new RegExp(`${num}\\s*${metres}\\b`, 'gi'),
  )) {
    add(m[1]);
  }
  for (const m of clean.matchAll(
    new RegExp(`${num}\\s*${yards}\\b`, 'gi'),
  )) {
    add(String(Math.round(Number(m[1].replace(/ /g, '')) * 0.9144)));
  }

  return { values: [...values].sort((a, b) => a - b), span };
}

/**
 * The distance specification for this application, from the published text.
 *
 * ⚠️ ONLY THE ASSOCIATION'S EXERCISE RULEBOOK ANSWERS THIS. The discipline
 * requirement paragraphs are prose about equipment, and their stray "m" values
 * are facilities ("the club with a 1 200 m range") and target dimensions, not
 * courses of fire — parsing them produced specs that admitted everything and
 * flagged correct documents. An exercise whose rule states no distance, an
 * association we hold no rulebook for, or no exercise at all returns null, and
 * the writer is told to describe the discipline without a distance. Omission is
 * honest; a remembered range is not.
 */
export function rangeSpecForAnswers(
  answers: Record<string, string>,
): DisciplineRangeSpec | null {
  const rule = rulebookForAnswers(answers);
  if (!rule) return null;
  // The exercise's own title often carries the distance ("100m, Small-Bore
  // Centre-Fire Rifle Exercise") even when the body's distance line is missing.
  const fromText = parseDistances(rule.text);
  const fromTitle = parseDistances(rule.title);
  const values = [...new Set([...fromText.values, ...fromTitle.values])].sort(
    (a, b) => a - b,
  );
  if (!values.length) return null;
  return {
    label: rule.title,
    values,
    span: fromText.span || fromTitle.span,
    source: 'exercise',
  };
}

/** "10 m" / "100 m, 200 m and 300 m" / "300 m to 900 m". */
export function describeDistances(spec: DisciplineRangeSpec): string {
  const { values, span } = spec;
  if (!values.length) return '';
  const at = values.map((v) => `${v} m`);
  if (at.length === 1) return at[0];
  if (span) return `${at[0]} to ${at[at.length - 1]}`;
  if (at.length === 2) return `${at[0]} and ${at[1]}`;
  return `${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`;
}

export function distanceFits(spec: DisciplineRangeSpec, metres: number): boolean {
  if (!spec.values.length) return false;
  if (spec.values.includes(metres)) return true;
  if (spec.span) {
    return metres >= spec.values[0] && metres <= spec.values[spec.values.length - 1];
  }
  return false;
}

/**
 * Every plain distance a sentence states, in metres.
 *
 * Uses the same millimetre guard as parseDistances, so "9 mm" and "12 gauge"
 * are not distances. Calibre names like ".308" carry no unit and are ignored.
 */
export function distancesInText(text: string): number[] {
  return parseDistances(text).values;
}

/**
 * The candidate uses that fit this discipline.
 *
 * ⚠️ A SENTENCE WITH NO DISTANCE IS KEPT. "I would like to shoot the club
 * league" is true of any discipline; only a sentence that names a distance the
 * published rules do not admit is dropped, because that is the one the writer
 * would otherwise lift into the document.
 */
export function usesFittingDiscipline(
  uses: readonly string[],
  spec: DisciplineRangeSpec | null,
): string[] {
  if (!spec) return [...uses];
  return uses.filter((sentence) => {
    const distances = distancesInText(sentence);
    return distances.every((m) => distanceFits(spec, m));
  });
}

/**
 * The generated uses, with the sport sentences this discipline does not admit
 * removed.
 *
 * ⚠️ THE FILTER RUNS AT GENERATION, NOT AT REVIEW. The writer is told to pick a
 * sentence whole; if the table offers "F-Class prone at 600 m" to a 20 m
 * handgun applicant, the defect is already one tap away from a signed document.
 * Removing it before the prompt is the only point at which it cannot be lifted.
 *
 * ⚠️ HUNTING SENTENCES ARE LEFT ALONE. A hunter's "at 200 m in the bushveld" is
 * about the quarry, not a course of fire, and this spec is a sport one.
 */
export function filterSportUsesForDiscipline(
  groups: readonly CandidateUses[],
  answers: Record<string, string>,
): CandidateUses[] {
  const spec = rangeSpecForAnswers(answers);
  if (!spec) return [...groups];
  return groups
    .map((group) =>
      /\bsport\b/i.test(group.label)
        ? { ...group, uses: usesFittingDiscipline(group.uses, spec) }
        : group,
    )
    .filter((group) => group.uses.length > 0);
}

/**
 * Distance claims in the document that the discipline does not admit.
 *
 * ⚠️ ONLY SENTENCES THAT TALK ABOUT THE COURSE ARE CHECKED. A sport motivation
 * may legitimately mention a 300 m practice shot while entered in a 20 m
 * exercise; what it may not do is say the 20 m exercise is shot at 300 m. So a
 * sentence is policed only when it carries a discipline marker — the course of
 * fire, a stage, the exercise, the discipline, the firing line, or the
 * exercise's own name.
 */
export function rangeViolations(
  text: string,
  spec: DisciplineRangeSpec | null,
): string[] {
  if (!spec) return [];
  const sentences = (text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const labelWords = spec.label
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
  const marker =
    /course of fire|\bstages?\b|\bexercises?\b|\bdisciplines?\b|firing line|shooting distance/i;
  const issues: string[] = [];
  const admitted = describeDistances(spec);
  for (const sentence of sentences) {
    const distances = distancesInText(sentence);
    if (!distances.length) continue;
    const lower = sentence.toLowerCase();
    const aboutTheCourse =
      marker.test(sentence) || labelWords.some((w) => lower.includes(w));
    if (!aboutTheCourse) continue;
    const wrong = distances.filter((m) => !distanceFits(spec, m));
    if (!wrong.length) continue;
    issues.push(
      `The document says ${wrong.map((m) => `${m} m`).join(' and ')} for ${spec.label}, but its published distance is ${admitted}. A DFO checks the course against the rulebook.`,
    );
  }
  return [...new Set(issues)];
}
