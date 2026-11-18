import { MotivationLicenceType } from '@prisma/client';
import { resolveSportingPurpose } from './motivation-purpose';

/**
 * ⚠️ THE DETAIL A MOTIVATION NEEDS TO EXIST, AS OPPOSED TO THE FORM BEING FILLED.
 *
 * `missingRequired()` answers "are the registry's boxes ticked"; this answers
 * "does the document have something to argue with". They are different
 * questions and both have to pass: a pack once generated from a complete form
 * and an empty history, and the member's only signal was an SMS after the fact
 * saying the application needed more detail.
 *
 * The list is drawn from three professional section 16 motivations the
 * operator supplied: every one carries a shooting history, a comparison, the
 * exact exercise the firearm is entered in, and the association facts that
 * make dedicated status checkable. Those are the arguments, so those are the
 * gates.
 *
 * ⚠️ THIS IS NOT A DOCUMENT GATE. Motivation-only packs never require an
 * annexure; they do require enough detail to write the argument.
 */
export interface DetailGap {
  /** A stable code the UI can route on. */
  code: string;
  /** What is missing, in the member's words. */
  label: string;
  /** Where to go and what to say. */
  hint: string;
}

const wordCount = (value: string): number =>
  value.trim() ? value.trim().split(/\s+/).length : 0;

const has = (answers: Record<string, string>, key: string): boolean =>
  Boolean((answers[key] ?? '').trim());

const GAP = (
  code: string,
  label: string,
  hint: string,
): DetailGap => ({ code, label, hint });

/**
 * A shooting history of fewer than a dozen words is a stub, not a history.
 *
 * ⚠️ SIXTY WAS A WALL, NOT A FLOOR. The interview asked for a paragraph in a
 * single box, and a member who had said where he started, what he shoots and
 * how often - in nineteen words - was refused and told he needed sixty. The
 * experience pages of the professional documents run 250-400 words, but those
 * are WRITTEN from the facts; the facts are what the member has to supply, and
 * a sentence or two supplies them.
 *
 * So the floor only separates "I like shooting" from a real answer, and the
 * interview's chips ("A friend introduced me", "Clay targets at a club") count
 * toward it because they are the member's own statements.
 */
export const MIN_HISTORY_WORDS = 12;

const HUNTING_TYPES: readonly MotivationLicenceType[] = [
  MotivationLicenceType.S15_OCCASIONAL_HUNTER,
  MotivationLicenceType.S16_DEDICATED_HUNTER,
];

const DEDICATED_TYPES: readonly MotivationLicenceType[] = [
  MotivationLicenceType.S16_DEDICATED_HUNTER,
  MotivationLicenceType.S16_DEDICATED_SPORT,
];

/** Does this application argue sport shooting at all? */
function isSporting(answers: Record<string, string>): boolean {
  const kind = (answers.firearm_use_kind ?? '').toLowerCase();
  return kind === 'sport' || kind === 'both';
}

export function missingDetail(
  answers: Record<string, string>,
  licenceType: MotivationLicenceType,
): DetailGap[] {
  const gaps: DetailGap[] = [];

  // ── the firearm ────────────────────────────────────────────────────────
  const firearm = [
    ['firearm_type', 'the type of firearm', 'Is it a rifle, shotgun or handgun?'],
    ['firearm_action', 'the action', 'Bolt, pump, semi-automatic — the card prints it.'],
    ['firearm_make', 'the make', 'Beretta, Glock, CZ — as the card prints it.'],
    ['firearm_model', 'the model', 'The model name or number on the card.'],
    ['firearm_calibre', 'the calibre', 'Exactly as the card prints it.'],
    ['firearm_serial', 'the serial number', 'The number stamped on the firearm.'],
  ] as const;
  for (const [key, label, hint] of firearm) {
    if (!has(answers, key)) gaps.push(GAP(`firearm:${key}`, label, hint));
  }

  // ── competency ─────────────────────────────────────────────────────────
  for (const [key, label, hint] of [
    ['competency_number', 'the competency certificate number', 'On the SAPS competency certificate.'],
    ['competency_for', 'what the competency covers', 'Handgun, rifle manual, shotgun — the certificate lists it.'],
    ['competency_issued', 'when the competency was issued', 'The issue date on the certificate.'],
  ] as const) {
    if (!has(answers, key)) gaps.push(GAP(`competency:${key}`, label, hint));
  }

  // ── the shooting life ──────────────────────────────────────────────────
  if (wordCount(answers.shooting_history ?? '') < MIN_HISTORY_WORDS) {
    gaps.push(
      GAP(
        'history:shooting_history',
        'your shooting history',
        'How you came to shooting, who introduced you, what you shoot and how often, what you hunt or compete in.',
      ),
    );
  }
  /**
   * ⚠️ THE COMPARISON IS NOT A GATE ANY MORE. "What else did you consider"
   * stays on the card as an optional case question, but a member with nothing
   * to compare was held here — and on the card — behind a red cross. The
   * comparison section is written from the battery and the rest of the facts
   * when it is skipped (operator, 2026-11-18).
   */

  // ── safe storage ───────────────────────────────────────────────────────
  /**
   * ⚠️ THE SAFE FOLLOW-UPS ARE CONDITIONAL, LIKE THEY ARE ON SCREEN. Demanding
   * "what it is mounted to" of somebody whose safe is not mounted — or "the
   * type of safe" of somebody who has none — blocked the pack on a question the
   * interview hid. The gate now follows the same showIf chain the card does.
   */
  const safePresent = (answers.safe_present ?? '').trim().toLowerCase() === 'yes';
  const safeMounted = (answers.safe_mounted ?? '').trim().toLowerCase() === 'yes';
  const safeRows: [string, string, string][] = [
    ['safe_present', 'whether there is a safe', 'A safe is required for every licence.'],
    ...(safePresent
      ? ([
          ['safe_type', 'the type of safe', 'Rifle safe, handgun safe, built-in.'],
          ['safe_mounted', 'whether the safe is mounted', 'Bolted or built in, not loose.'],
          ['safe_key_holder', 'who holds the key', 'Only you, or somebody else.'],
        ] as [string, string, string][])
      : []),
    ...(safePresent && safeMounted
      ? ([
          ['safe_mounted_to', 'what it is mounted to', 'A wall, a floor, a concrete slab.'],
        ] as [string, string, string][])
      : []),
  ];
  for (const [key, label, hint] of safeRows) {
    if (!has(answers, key)) gaps.push(GAP(`safe:${key}`, label, hint));
  }

  // ── the security paragraph a self-defence document carries ─────────────
  /**
   * ⚠️ HEADING 5 IS WRITTEN FROM THE PREMISES BLOCK, AND NOTHING ASKED FOR IT.
   * The interview's walk skipped every profile-scoped `premises_*` field, so a
   * cold section 13 applicant could finish with a name, a serial and a safe and
   * still be "complete". The enclosure is the one tap the rest of the block
   * hangs off (alarm, response, bars, gates all follow it), so it is the gap.
   */
  if (
    (licenceType === MotivationLicenceType.S13_SELF_DEFENCE ||
      licenceType === MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE) &&
    !has(answers, 'premises_enclosure')
  ) {
    gaps.push(
      GAP(
        'premises:premises_enclosure',
        'what already protects your home',
        'The wall, fence or gate, and what else you have done. The document says where those measures stop.',
      ),
    );
  }

  // ── the purpose ────────────────────────────────────────────────────────
  /**
   * ⚠️ `firearm_use_kind` IS NOT A GATE ANY MORE. The registry retired it as a
   * question on 2026-10-17 ("the route is decided from the applicant's
   * paperwork, their battery and the firearm itself"), and `resolveSportingPurpose`
   * is that rule: a handgun or self-loader is sport, a dangerous-game chambering
   * is hunting, and an explicit answer wins where the interview asked one.
   *
   * ⚠️ AND THE QUARRY FOLLOWS THE RESOLVED PURPOSE, NOT THE RAW ANSWER. It used
   * to demand "the species you intend to hunt" of every S16-hunter row, so a
   * Glock 43X for dedicated sport was gated on hunting quarry — a question its
   * sport branch never asks. MO000115 could not generate until the purpose was
   * written through the API.
   */
  const purpose = resolveSportingPurpose(answers);
  const hunts =
    HUNTING_TYPES.includes(licenceType) && purpose !== 'sport';
  if (hunts && !has(answers, 'intended_quarry')) {
    gaps.push(
      GAP(
        'purpose:intended_quarry',
        'the species you intend to hunt',
        'The quarry the caliber is chosen for.',
      ),
    );
  }
  /**
   * ⚠️ A RENEWAL TURNS ON TWO FACTS AND ONLY ONE WAS ASKED. "The purpose has
   * not changed, and you are still active" is the whole argument, and
   * `continued_use` — the active half — was optional and never put to the
   * member. A one-word answer is still not a fact, so it keeps the floor the
   * history uses.
   */
  if (
    licenceType === MotivationLicenceType.S24_RENEWAL &&
    wordCount(answers.continued_use ?? '') < 8
  ) {
    gaps.push(
      GAP(
        'renewal:continued_use',
        'how you have kept using the firearm',
        'What you have actually done with it since it was issued — hunts, matches, practice.',
      ),
    );
  }

  // ── the association, where the section turns on it ─────────────────────
  if (DEDICATED_TYPES.includes(licenceType)) {
    for (const [key, label, hint] of [
      ['association_name', 'your accredited association', 'The body that awarded your dedicated status.'],
      ['association_number', 'your membership number', 'As it appears on the membership card.'],
      ['association_joined', 'when you joined', 'The membership date, which is usually earlier than the dedicated date.'],
      ['dedicated_since', 'when dedicated status was awarded', 'On the dedicated-status certificate.'],
    ] as const) {
      if (!has(answers, key)) gaps.push(GAP(`association:${key}`, label, hint));
    }
  }

  // ── the exercise, and its published rulebook ───────────────────────────
  const needsExercise =
    licenceType === MotivationLicenceType.S16_DEDICATED_SPORT ||
    (licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER &&
      isSporting(answers));
  if (needsExercise && !has(answers, 'discipline_exercise')) {
    gaps.push(
      GAP(
        'exercise:discipline_exercise',
        'the exercise this firearm is entered in',
        'Your association publishes its exercises by code; pick the one this firearm is for so its rules can be attached.',
      ),
    );
  }

  return gaps;
}

/** The same list, as the sentence a member reads. */
export function missingDetailMessage(gaps: readonly DetailGap[]): string {
  if (!gaps.length) return '';
  const labels = gaps.map((gap) => gap.label);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `This motivation is not ready to write yet — it still needs ${list}.`;
}
