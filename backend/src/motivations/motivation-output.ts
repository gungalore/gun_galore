/**
 * What the member asked us to produce.
 *
 * MOTIVATION_ONLY  the legal motivation on its own. This is the default: it is
 *                  the document the applicant signs and hands to the DFO, and
 *                  it needs no documents from the member to be written.
 * PRINT_READY      the same motivation plus the lettered annexures, in order,
 *                  with their letters and the document checks. It is a pack,
 *                  NOT a form: we do not fill in a SAPS 271. Choosing it means
 *                  bringing the documents, because there is nothing to letter
 *                  without them.
 * LETTER_CHECKLIST the motivation plus a bring-original checklist, written
 *                  from typed details. No copies are attached automatically
 *                  and the required-document gate does not block it; the DFO
 *                  still receives the originals in person.
 *
 * ⚠️ THE MODE CHANGES THE QUESTIONS, THE DOCUMENT GATE AND WHAT IS PRINTED. It
 * never changes the legal standard the motivation itself is written to.
 *
 * ⚠️ `FULL_PACK` IS THE OLD NAME FOR PRINT_READY. It is normalised, never
 * dropped: every row written before this column changed its default is a pack,
 * and silently reading it as motivation-only would take a member's annexures
 * away.
 */
export const OUTPUT_MODES = [
  'MOTIVATION_ONLY',
  'PRINT_READY',
  'LETTER_CHECKLIST',
] as const;

export type MotivationOutputMode = (typeof OUTPUT_MODES)[number];

export const DEFAULT_OUTPUT_MODE: MotivationOutputMode = 'MOTIVATION_ONLY';

export function normaliseOutputMode(value: unknown): MotivationOutputMode {
  if (value === 'MOTIVATION_ONLY') return 'MOTIVATION_ONLY';
  if (value === 'PRINT_READY') return 'PRINT_READY';
  if (value === 'LETTER_CHECKLIST') return 'LETTER_CHECKLIST';
  // Rows created under the old name.
  if (value === 'FULL_PACK') return 'PRINT_READY';
  return DEFAULT_OUTPUT_MODE;
}

export function isMotivationOnly(value: unknown): boolean {
  return normaliseOutputMode(value) === 'MOTIVATION_ONLY';
}

/** The documents pack: required copies are attached and gated. */
export function isPrintReady(value: unknown): boolean {
  return normaliseOutputMode(value) === 'PRINT_READY';
}

/** The typed-details pack: no automatic copies, originals checklist. */
export function isLetterChecklist(value: unknown): boolean {
  return normaliseOutputMode(value) === 'LETTER_CHECKLIST';
}

/** Any pack output, with or without attached copies. */
export function isPackMode(value: unknown): boolean {
  const mode = normaliseOutputMode(value);
  return mode === 'PRINT_READY' || mode === 'LETTER_CHECKLIST';
}
