import { MotivationLicenceType } from '@prisma/client';
import { MotivationField, fieldsFor, isVisible } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// HOW FAR ALONG THE APPLICATION IS, SECTION BY SECTION.
//
// Operator, 2026-08-28: "I also don't realy like the bunch of block for the
// filled out fields of the 271. Rather gives the sections required with a
// persentage of each sections based on how much actually is filled out
// already. Put it on every page."
//
// ────────────────────────────────────────────────────────────────────
// ⚠️ THE UNIT IS THE QUESTION, NOT THE BOX. This is the whole design and it
// was got wrong once.
//
// The obvious implementation counts boxes on the SAPS 271 — there are 144
// mapped, so "38 of 61" writes itself. It is the wrong denominator, because
// one question fills wildly different numbers of boxes: marital status ticks
// one of five, an identity number fills a thirteen-cell character row, and a
// single owned-firearm licence fills six. Progress would lurch — answer one
// thing and jump six, answer the next and move one — and the number would be
// bookkeeping about a form the applicant has never seen.
//
// "Twelve of eighteen questions" is something they can act on. So the unit is
// the REGISTRY FIELD: the question actually put to them.
//
// ⚠️ AND "APPLIES TO ME" IS isVisible(), NOT A SECOND MODEL. The registry
// already decides what to ask: `showIf` closes a history question's four
// follow-ups when the answer is no, and `formOnly` hides everything that
// exists only for the 271 when the applicant did not opt in. Deriving
// applicability separately would give us two answers to one question, and the
// meter would eventually disagree with the form it is measuring.
//
// The one thing isVisible CANNOT express is a repeating grid — see the
// owned-firearm rule below, which is the only bespoke applicability in here.
// ────────────────────────────────────────────────────────────────────

export type CoverageStatus =
  | 'complete'
  | 'in-progress'
  | 'not-started'
  /** Somebody else answers this section. Never scored against the applicant. */
  | 'theirs';

export interface CoverageSection {
  /** The letter the SAPS 271 uses, so the panel and the form agree. */
  id: string;
  label: string;
  /** Questions that apply to THIS applicant. Never the registry's raw total. */
  applicable: number;
  answered: number;
  /**
   * 0–100, or NULL for a section nobody scores.
   *
   * ⚠️ NULL RATHER THAN ZERO, DELIBERATELY. Section F is the seller's to
   * answer; a numeric 0 sitting beside the applicant's own 80% reads as their
   * failure, and it is the kind of value a renderer picks up without thinking.
   * A null cannot be drawn as an empty bar by accident — it has to be handled.
   */
  percent: number | null;
  /**
   * Of the applicable questions, how many are REQUIRED and still empty.
   *
   * Carried beside the percentage because they answer different questions: the
   * percentage says how much is done, this says whether it can be lodged. A
   * section can sit at 80% with nothing blocking, or at 95% with the one
   * answer that matters still missing.
   */
  missingRequired: number;
  status: CoverageStatus;
  note?: string;
}

export interface Saps271Coverage {
  sections: CoverageSection[];
  applicable: number;
  answered: number;
  /** Always a number: the overall count never includes an unscored section. */
  percent: number;
}

/** What the builder cannot know by itself. */
export interface CoverageContext {
  /**
   * Where the seller's half stands, if this is a private sale. Section F is
   * his to answer, so it carries a status and never a score.
   */
  seller?: { status: 'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED'; name?: string };
}

/**
 * Panel section → the registry sections behind it.
 *
 * ⚠️ THE REGISTRY GROUPS BY SUBJECT, THE FORM GROUPS BY LETTER, and neither
 * is wrong. This is the join. A registry section that does not exist for a
 * licence type simply contributes nothing, so a section 13 application shows
 * no dedicated-status row rather than an empty one.
 */
const PANEL: { id: string; label: string; from: string[] }[] = [
  { id: 'E', label: 'The firearm', from: ['The firearm', 'The existing licence'] },
  { id: 'G1', label: 'Your competency', from: ['Your competency'] },
  { id: 'G2', label: 'Firearms you own', from: ['Firearms you already own'] },
  { id: 'G3', label: 'About you', from: ['About you', 'Your circumstances'] },
  { id: 'G4', label: 'Dedicated status', from: ['Dedicated status', 'Experience'] },
  { id: 'S', label: 'Safe and storage', from: ['Storage and safety'] },
  { id: 'H', label: 'Declarations', from: ['History'] },
];

/**
 * ⚠️ 'The SAPS 271 form' IS DELIBERATELY NOT ON THE PANEL. Its one field is
 * the opt-in — a preference about how we help, not a question the Registrar
 * asks. Counting it would let a member raise their completeness by choosing a
 * setting.
 */
const EXCLUDED_SECTION = 'The SAPS 271 form';

const OWNED_SECTION = 'Firearms you already own';
const OWNED_PREFIX = 'existing_firearm_';
/** Rows the 271 map fills today. The paper form holds 26; we map six. */
const OWNED_ROWS = 6;

/** `existing_firearm_3_make` → 3. Anything else → null. */
function ownedRowOf(key: string): number | null {
  if (!key.startsWith(OWNED_PREFIX)) return null;
  const n = parseInt(key.slice(OWNED_PREFIX.length).split('_')[0], 10);
  return Number.isFinite(n) ? n : null;
}

const answered = (answers: Record<string, string>, key: string) =>
  (answers[key] ?? '').trim() !== '';

/**
 * Which owned-firearm rows count.
 *
 * ⚠️ THE ONE PLACE isVisible IS NOT ENOUGH. The registry carries six fixed
 * rows of seven fields and none of them is conditional, so isVisible says all
 * forty-two apply — always. An applicant who owns one firearm would then sit
 * at a seventh of a section for ever, through no fault of their own, which is
 * exactly the misleading number this whole module exists to avoid.
 *
 * A row counts once it is IN USE. When none is, the first one counts: the
 * applicant is being asked for their first firearm, and a section with nothing
 * applicable would read as complete when it has not been started.
 */
function applicableOwnedRows(answers: Record<string, string>): Set<number> {
  const used = new Set<number>();
  for (let n = 1; n <= OWNED_ROWS; n++) {
    for (const key of Object.keys(answers)) {
      if (ownedRowOf(key) === n && answered(answers, key)) {
        used.add(n);
        break;
      }
    }
  }
  if (!used.size) used.add(1);
  return used;
}

/**
 * A percentage that never lies at either end.
 *
 * ⚠️ 99.6% MUST NOT PRINT AS 100. A member reading "100%" on a section with an
 * unanswered question stops looking at it. And a section with one answer of
 * two hundred must not print as 0, or the work they did looks lost.
 */
export function percentOf(answeredCount: number, applicable: number): number {
  if (applicable === 0) return 100;
  if (answeredCount >= applicable) return 100;
  if (answeredCount === 0) return 0;
  return Math.min(99, Math.max(1, Math.round((answeredCount / applicable) * 100)));
}

function statusOf(answeredCount: number, applicable: number): CoverageStatus {
  if (applicable === 0 || answeredCount >= applicable) return 'complete';
  return answeredCount === 0 ? 'not-started' : 'in-progress';
}

/**
 * Section-by-section completeness of the application, counted in questions.
 *
 * Pure: no Prisma, no clock. Everything it cannot know is passed in.
 */
export function saps271Coverage(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
  context: CoverageContext = {},
): Saps271Coverage {
  const fields = fieldsFor(licenceType).filter(
    (f: MotivationField) => f.section !== EXCLUDED_SECTION,
  );
  const ownedRows = applicableOwnedRows(answers);

  /** Does this question apply to this applicant, right now? */
  const applies = (f: MotivationField): boolean => {
    if (!isVisible(f, answers)) return false;
    if (f.section === OWNED_SECTION) {
      const row = ownedRowOf(f.key);
      // `overlap_justification` lives in this section and belongs to no row.
      if (row !== null && !ownedRows.has(row)) return false;
    }
    return true;
  };

  const sections: CoverageSection[] = [];

  // ── D: the section applied for ──
  //
  // Not a registry field — it is the licence type itself, chosen before the
  // application exists. It is on the panel because the form has a section D
  // and leaving a gap where the applicant expects one reads as an omission.
  sections.push({
    id: 'D',
    label: 'Type of application',
    applicable: 1,
    answered: 1,
    percent: 100,
    missingRequired: 0,
    status: 'complete',
    note: 'Chosen when you started.',
  });

  for (const panel of PANEL) {
    const mine = fields.filter((f) => panel.from.includes(f.section)).filter(applies);
    if (!mine.length) continue; // Not part of this licence type at all.

    const done = mine.filter((f) => answered(answers, f.key));
    const missingRequired = mine.filter(
      (f) => f.required && !answered(answers, f.key),
    ).length;

    const section: CoverageSection = {
      id: panel.id,
      label: panel.label,
      applicable: mine.length,
      answered: done.length,
      percent: percentOf(done.length, mine.length),
      missingRequired,
      status: statusOf(done.length, mine.length),
    };

    if (panel.id === 'G2') {
      const rows = [...ownedRows].filter((n) =>
        Object.keys(answers).some(
          (k) => ownedRowOf(k) === n && answered(answers, k),
        ),
      ).length;
      section.note = rows
        ? `${rows} firearm${rows === 1 ? '' : 's'} listed.`
        : 'Add the firearms you already hold.';
    }
    if (panel.id === 'H' && section.applicable && section.answered === section.applicable) {
      section.note = 'Answered.';
    }

    sections.push(section);
  }

  // ── F: the current owner's half ──
  //
  // ⚠️ STATUS, NEVER A PERCENTAGE. Section F is the seller's to complete. A
  // score would be the applicant being shown a mark for somebody else's
  // homework — and a 0% next to their own 80% reads as their failure.
  const seller = context.seller;
  if (seller && seller.status !== 'NONE') {
    const who = (seller.name ?? '').trim() || 'the seller';
    sections.push({
      id: 'F',
      label: 'Current owner',
      applicable: 0,
      answered: 0,
      percent: null,
      missingRequired: 0,
      status: seller.status === 'COMPLETED' ? 'complete' : 'theirs',
      note:
        seller.status === 'COMPLETED'
          ? `${who} has signed his half.`
          : seller.status === 'DECLINED'
            ? `${who} declined — upload a certified copy of his licence instead.`
            : `Waiting on ${who}. Nothing for you to do.`,
    });
  }

  // ⚠️ THE TOTAL IS RECOUNTED, NOT AVERAGED. Averaging the section
  // percentages would weight a three-question section the same as a
  // thirty-six-question one, so answering the shortest section would move the
  // headline number further than answering the longest.
  //
  // Sections owned by somebody else contribute nothing to either side of it,
  // which their applicable: 0 already ensures.
  const totalApplicable = sections.reduce((n, s) => n + s.applicable, 0);
  const totalAnswered = sections.reduce((n, s) => n + s.answered, 0);

  return {
    sections,
    applicable: totalApplicable,
    answered: totalAnswered,
    percent: percentOf(totalAnswered, totalApplicable),
  };
}
