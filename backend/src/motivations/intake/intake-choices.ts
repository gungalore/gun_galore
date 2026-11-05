import type { IntakeChoice } from './intake.types';

/**
 * HOW MANY TAPS A QUESTION MAY OFFER.
 *
 * Five is the point where a row of chips stops being a shortlist and starts
 * being a form. The prompt asks the model for 3-5; this is the hard ceiling
 * that holds even when it ignores that.
 */
export const MAX_INTERVIEW_CHOICES = 5;

/**
 * The longest a single answer may be before it is a paragraph, not a button.
 * A chip the applicant cannot read at a glance is worse than a text box: it
 * looks like the interview has already written the answer for them.
 */
export const MAX_CHOICE_LENGTH = 90;

/**
 * ADD A TYPED ANSWER TO THE BUTTONS ALREADY TICKED.
 *
 * ⚠️ THE TICKED ANSWERS SURVIVE. MO000059 ticked a species chip and typed
 * "snakes" in the same answer; the typed text was assigned over the field and
 * the tick was lost, so a document that should have named two quarries named
 * one. The applicant's own selection and their own words are both theirs, and
 * this keeps both — de-duplicated, in the order they were given.
 */
export function addCustomChoice(
  current: string | undefined,
  message: string,
): string {
  const kept = (current ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const typed = message.trim();
  if (!typed) return kept.join(', ');
  return [...new Set([...kept, typed])].join(', ');
}

/**
 * TURN WHATEVER THE MODEL RETURNED INTO CHIPS WE CAN ACTUALLY RENDER.
 *
 * Accepts the two shapes the model has produced in practice — bare strings and
 * `{ value, label }` objects — and enforces the rules the UI assumes:
 *
 *  - an empty value is not a choice;
 *  - the same answer twice is one button, compared case-insensitively, because
 *    "I own a farm" and "I own a farm." read as one option to a person;
 *  - a "choice" that just repeats the field's own label ("Occupation") is not
 *    an answer and would be tapped by nobody;
 *  - an over-long string is dropped rather than truncated, so a half-sentence
 *    never becomes a tap that fills in a broken value.
 *
 * ⚠️ THE VALUE IS WHAT GETS STORED. The label is what the applicant reads, so
 * when only one is usable it becomes both — never drop one silently and leave a
 * button that stores an empty string.
 */
export function normaliseChoices(
  raw: unknown,
  options: { fieldLabel?: string } = {},
): IntakeChoice[] {
  if (!Array.isArray(raw)) return [];
  const fieldLabel = (options.fieldLabel ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const choices: IntakeChoice[] = [];
  for (const item of raw) {
    let value = '';
    let label = '';
    if (typeof item === 'string') {
      value = item.trim();
      label = value;
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      value = typeof record.value === 'string' ? record.value.trim() : '';
      label =
        typeof record.label === 'string' ? record.label.trim() : value;
      if (!value) value = label;
      if (!label) label = value;
    }
    if (!value || !label) continue;
    if (value.length > MAX_CHOICE_LENGTH) continue;
    if (label.length > MAX_CHOICE_LENGTH) label = value;
    if (fieldLabel && value.toLowerCase() === fieldLabel) continue;
    const fingerprint = value.toLowerCase().replace(/[.!]+$/, '');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    choices.push({ value, label });
    if (choices.length >= MAX_INTERVIEW_CHOICES) break;
  }
  return choices;
}
