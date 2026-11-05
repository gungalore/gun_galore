import { MotivationLicenceType } from '@prisma/client';

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
 * A shooting history of fewer than sixty words is a stub, not a history.
 *
 * Measured against the three professional documents: their experience pages
 * run 250–400 words. Sixty is the floor at which something is being described
 * rather than acknowledged, and it is deliberately well under what a motivated
 * applicant writes so it never becomes a word-count exercise.
 */
export const MIN_HISTORY_WORDS = 60;

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
  if (!has(answers, 'alternative_considered')) {
    gaps.push(
      GAP(
        'firearm:alternative_considered',
        'what else you considered',
        'The other model, calibre or type you weighed up, and the reason this firearm won.',
      ),
    );
  }

  // ── safe storage ───────────────────────────────────────────────────────
  for (const [key, label, hint] of [
    ['safe_present', 'whether there is a safe', 'A safe is required for every licence.'],
    ['safe_type', 'the type of safe', 'Rifle safe, handgun safe, built-in.'],
    ['safe_mounted', 'whether the safe is mounted', 'Bolted or built in, not loose.'],
    ['safe_mounted_to', 'what it is mounted to', 'A wall, a floor, a concrete slab.'],
    ['safe_key_holder', 'who holds the key', 'Only you, or somebody else.'],
  ] as const) {
    if (!has(answers, key)) gaps.push(GAP(`safe:${key}`, label, hint));
  }

  // ── the purpose ────────────────────────────────────────────────────────
  if (!has(answers, 'firearm_use_kind')) {
    gaps.push(
      GAP(
        'purpose:firearm_use_kind',
        'what the firearm is for',
        'Hunting, sport shooting, or both.',
      ),
    );
  }
  if (HUNTING_TYPES.includes(licenceType) && !has(answers, 'intended_quarry')) {
    gaps.push(
      GAP(
        'purpose:intended_quarry',
        'the species you intend to hunt',
        'The quarry the caliber is chosen for.',
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
