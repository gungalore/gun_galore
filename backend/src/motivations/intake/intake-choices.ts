import { exercisesFor, resolveAssociation } from '../association-rules';
import type { IntakeChoice } from './intake.types';

/**
 * HOW MANY TAPS A QUESTION MAY OFFER.
 *
 * ⚠️ SIX, BECAUSE FIVE WAS LEAVING REAL ANSWERS OUT. Operator, 2026-11-06:
 * "If there is viable answers more than two it should be given to the user."
 * The hard ceiling only exists so a model cannot turn a question into a form;
 * it is not a target, and six still fits a card without wrapping into a wall.
 */
export const MAX_INTERVIEW_CHOICES = 6;

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

/**
 * THE EXERCISE CHIPS, FROM THE ASSOCIATION'S PUBLISHED RULES.
 *
 * ?? VALUE IS THE TITLE. `rulesFor()` matches an exercise by code OR title, and
 * the sheet should read "100m, Small-Bore Centre-Fire Rifle Exercise" rather
 * than "Com13". The label carries the code so a member recognises it from the
 * association's own literature.
 *
 * ?? AN UNKNOWN ASSOCIATION IS NOT AN ERROR. We hold rulebooks for two bodies;
 * a member of a third gets the free-text question the field already is, which
 * is why this returns [] rather than throwing.
 */
export function exerciseChoices(
  associationName: string | undefined,
  firearmType: string | undefined,
): IntakeChoice[] {
  const slug = resolveAssociation(associationName);
  if (!slug) return [];
  const seen = new Set<string>();
  const out: IntakeChoice[] = [];
  for (const exercise of exercisesFor(slug, firearmType)) {
    const title = exercise.title.trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      value: title,
      label: exercise.code ? `${exercise.code} - ${title}` : title,
    });
    // A wall of 61 buttons is not a shortlist either.
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * THE HISTORY, AS TAPS.
 *
 * ⚠️ A BLANK BOX BESIDE A WORD FLOOR IS A TRAP, AND IT SPRUNG.
 *
 * The question asked for a whole shooting life in one paragraph and the gate
 * refused anything under sixty words. A live member described where he started,
 * what he shoots and how often in nineteen words, was told he needed sixty, and
 * asked why we refused an answer we had just invited. The two chips he could
 * tick were the model's topic labels ("Clay pigeon shooting", "Bird hunting"),
 * which name a discipline but never say who introduced him or how often he
 * shoots - so tapping them looks like answering while the floor still refuses.
 *
 * So the facts the section actually writes from are chips, in the member's own
 * voice: who introduced them, what they shoot, how often. They are statements,
 * not topics, so a tick reads as a sentence in the sheet and two ticks clear
 * the floor without typing a word.
 */
export const HISTORY_CHOICES: readonly IntakeChoice[] = [
  {
    value: 'I was taught to shoot by a family member',
    label: 'A family member taught me',
  },
  { value: 'I grew up with firearms on a farm', label: 'I grew up on a farm' },
  { value: 'A friend introduced me to the sport', label: 'A friend introduced me' },
  { value: 'I learned to shoot at a club', label: 'I learned at a club' },
  { value: 'I shoot clay targets at a club', label: 'Clay targets at a club' },
  { value: 'I hunt birds and small game', label: 'Birds and small game' },
  { value: 'I hunt plains game', label: 'Plains game' },
  { value: 'I am at the range most weekends', label: 'At the range most weekends' },
];

/**
 * HOW MUCH WAS SAID, TICKS INCLUDED.
 *
 * ⚠️ THE TICKS ARE THE ANSWER, SO THEY ARE COUNTED. The gate read only the
 * typed text, so ticked statements scored zero and a member who had answered by
 * tapping was told he had said nothing at all.
 */
export function historyAnswerWords(
  values: readonly string[] | undefined,
  message: string | undefined,
): number {
  const said = [...(values ?? []), message ?? ''].join(' ').trim();
  return said ? said.split(/\s+/).filter(Boolean).length : 0;
}
