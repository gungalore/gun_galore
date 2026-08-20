import { MotivationLicenceType } from '@prisma/client';
import { fieldsFor, isVisible, MotivationField } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// WHAT IS STILL MISSING — WORKED OUT IN CODE, FOR NOTHING.
//
// Operator, 2026-08-18: ask consent for whatever the profile can give us, and
// let Claude ask the right questions for the rest — "or if we can keep cost
// down write something to detect those and give to Claude to cover it in the
// questions".
//
// That is exactly the split, and this is the free half. Finding a gap is
// arithmetic over the field registry: we know every field, which ones are
// required, which are conditional, and what the applicant has typed. A model
// adds nothing to that and would charge for the privilege — worse, it might
// hallucinate a gap that does not exist, or miss one that does.
//
// So: CODE finds the gaps and ranks them, and Claude does the one thing it is
// actually better at — turning a list of field names into questions a person
// wants to answer.
//
// ⚠️ THE COST BUG THIS EXISTS TO FIX. queueFollowUps used to call Claude ONCE
// PER FIELD, up to three times per failed gate. Every one of those carried the
// whole system prompt. Batching is not a micro-optimisation here: it is the
// difference between one request and three for the same result, on the module
// where the operator has already said margin matters.
//
// PURE — no Nest, no Prisma, no clock, no network.
// ────────────────────────────────────────────────────────────────────

/** Why a field is being asked about. Drives ordering and tone. */
export type GapReason =
  | 'missing_required'
  | 'thin'
  | 'missing_optional'
  | 'overlap';

export interface Gap {
  key: string;
  label: string;
  help?: string;
  section: string;
  reason: GapReason;
  /** What they have written so far. Empty for a field never answered. */
  current: string;
  /** Lower sorts first. */
  rank: number;
}

/**
 * How thin is too thin.
 *
 * Only applied to `long` fields, and only as a FLOOR. It is not a quality
 * judgement — the gate does that with a model — it is the cheap catch for "I
 * hunt" typed into a box asking for a hunting history. Anything above this is
 * left for the gate to weigh.
 */
const THIN_CHARS = 80;

const REASON_RANK: Record<GapReason, number> = {
  // Cannot generate at all without these.
  missing_required: 0,
  // Will fail the gate, or already has.
  thin: 1,
  // The document is refusable without it even though the field is optional.
  overlap: 2,
  // Would strengthen it. Asked last, and only if there is room.
  missing_optional: 3,
};

/**
 * Everything still outstanding, best question first.
 *
 * `thinFields` is what the quality gate named, if it has run. Passing it lets a
 * gate finding outrank a merely-empty optional field, which is the right order:
 * a paragraph the reviewer already called thin matters more than a box nobody
 * has looked at.
 */
export function findGaps(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
  opts: { thinFields?: string[]; overlapNeedsJustification?: boolean } = {},
): Gap[] {
  const thin = new Set(opts.thinFields ?? []);
  const gaps: Gap[] = [];

  for (const f of fieldsFor(licenceType)) {
    // A conditional field that does not apply is not a gap. Asking a single
    // applicant for their spouse's ID number is how a wizard loses someone.
    if (!isVisible(f, answers)) continue;
    // Form-only fields are boxes on the SAPS 271, not things to interview about
    // — nobody needs a warmly-phrased question about their postal code.
    if (f.formOnly) continue;
    // ⚠️ NOR IS THE OWNED-FIREARMS TABLE, which used to be excluded by being
    // formOnly and no longer is: motivation-overlap reads it and the writer
    // argues from it, so it has to be asked on the dealer path too. But it is
    // still six columns TRANSCRIBED off a licence, and "tell me more about
    // Firearm 5 — barrel serial no" is not a question anyone should be asked
    // in words. Wrong values here come from a misread document, not from an
    // applicant who needs drawing out.
    if (/^existing_firearm_\d+_/.test(f.key)) continue;

    const current = (answers[f.key] ?? '').trim();
    const reason = reasonFor(f, current, thin);
    if (!reason) continue;

    gaps.push({
      key: f.key,
      label: f.label,
      help: f.help,
      section: f.section,
      reason,
      current,
      rank: REASON_RANK[reason],
    });
  }

  // The overlap justification is optional in the registry because most
  // applicants never need it. When the overlap check has found a firearm in the
  // same class, it stops being optional in practice — the application is
  // refusable without it — so it is promoted rather than left at the bottom.
  if (opts.overlapNeedsJustification) {
    const g = gaps.find((x) => x.key === 'overlap_justification');
    if (g) {
      g.reason = 'overlap';
      g.rank = REASON_RANK.overlap;
    }
  } else {
    const i = gaps.findIndex((x) => x.key === 'overlap_justification');
    if (i >= 0) gaps.splice(i, 1);
  }

  // Stable within a rank: registry order, which is the order the wizard shows
  // them, so the questions follow the form rather than jumping about.
  return gaps.sort((a, b) => a.rank - b.rank);
}

function reasonFor(
  f: MotivationField,
  current: string,
  _thin: Set<string>,
): GapReason | null {
  // ⚠️ ONLY WHAT BLOCKS THE DOCUMENT IS WORTH A QUESTION. This used to also
  // ask about thin answers and empty optional fields, and every failed gate
  // cycle backfilled three more — the operator opened his application to an
  // interrogation about his employer's address and the barrel length, seven
  // near-identical "could you tell me a bit more about X" cards deep.
  //
  // Nobody who PAYS for a motivation answers technical questionnaires: the
  // writer supplies the standard rationale for the use case, and the
  // applicant supplies identity, paperwork and record. So Boet asks only for
  // a required answer that is MISSING — the thing without which the document
  // cannot be written at all. A thin answer is the writer's craft to carry,
  // not the applicant's homework.
  if (!current && f.required) return 'missing_required';
  // The ONE exception: the overlap justification. It is optional in the
  // registry because most applicants never need it, but when the overlap
  // check fires the application is refusable without it — and why somebody
  // wants a second firearm in the same class is knowledge only they hold, not
  // something a writer can supply. The caller promotes it when the overlap is
  // real and deletes it when it is not.
  if (!current && f.key === 'overlap_justification') return 'missing_optional';
  return null;
}

/**
 * The brief handed to Claude — ONE call, however many questions.
 *
 * Deliberately compact. Everything the model needs to phrase a question is the
 * label, the help text and roughly how much the applicant has written; it does
 * NOT need their prose, and sending it would put someone's security
 * circumstances into a request that exists only to word a question.
 *
 * ⚠️ `current` is summarised as a LENGTH, never quoted. That is a real
 * privacy decision, not brevity: the follow-up prompt is the one place in this
 * pipeline that has no business seeing the answers.
 */
export function gapBrief(gaps: Gap[]): {
  key: string;
  label: string;
  help?: string;
  reason: GapReason;
  wordsSoFar: number;
}[] {
  return gaps.map((g) => ({
    key: g.key,
    label: g.label,
    help: g.help,
    reason: g.reason,
    wordsSoFar: g.current ? g.current.split(/\s+/).filter(Boolean).length : 0,
  }));
}

/**
 * The question we ask when Claude is unavailable, or returns nothing usable.
 *
 * Costs nothing and is always available, which is the point: a plain question
 * beats no question, and an applicant must never be stuck because a model call
 * failed.
 */
export function fallbackQuestion(gap: Gap): string {
  const base =
    gap.reason === 'thin'
      ? `Could you tell me a bit more about ${gap.label.toLowerCase()}?`
      : `Could you tell me about ${gap.label.toLowerCase()}?`;
  return gap.help ? `${base} ${gap.help}` : base;
}

/**
 * How many to ask at once.
 *
 * Three. A wall of questions after a failed gate reads as punishment and gets
 * abandoned, and the applicant can always come back for the next three.
 */
export const FOLLOW_UP_BATCH = 3;
