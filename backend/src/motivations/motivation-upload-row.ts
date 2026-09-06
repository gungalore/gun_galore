import { MotivationUploadKind } from '@prisma/client';
import {
  Endorsement,
  parseEndorsements,
} from '../common/sa-competency';

// ────────────────────────────────────────────────────────────────────
// WHAT A ROW IN THE DOCUMENT LIST HAS TO SAY ABOUT ITSELF.
//
// Every attached document already carried a label, a size and a readability
// verdict. What it never carried was the one fact a DFO checks first: is this
// still valid on the day the pack is lodged.
//
// The date was not missing from the system — it is on the vault row the
// document was copied from, and it is in the reading vision took off the page.
// It was simply never put on the row, so a member looking at a complete-looking
// checklist could be looking at a letter of good standing that lapsed in March.
//
// ⚠️ NINETY DAYS IS THE OPERATOR'S NUMBER AND IT IS THE SAME ONE AUTO-LINK
// USES. SAPS takes months over an application, so a document with three weeks
// left is one the DFO rejects long before a decision. Amber is therefore not
// "nearly expired" — it is "expired by the time this is read".
//
// ⚠️ AND EXPIRED IS RED, NOT AN ERROR. Nothing is removed, nothing is blocked.
// A member may have a very good reason to lodge with a document we think is
// stale, and being wrong about that in a way that deletes their evidence is far
// worse than a red line they can read and act on.
//
// PURE — no Nest, no Prisma, no clock. `today` is a parameter so every rule
// here is testable at a frozen date.
// ────────────────────────────────────────────────────────────────────

/** How much life a document needs before the row stops warning. */
export const ROW_CAUTION_DAYS = 90;

export interface UploadCaution {
  tone: 'amber' | 'red';
  /** One plain sentence, said to the applicant. */
  text: string;
}

const DAY = 86_400_000;

/** Whole days from `today` to a yyyy-mm-dd day, or null if unreadable. */
export function daysUntilDay(expiresOn: string, today: Date): number | null {
  const end = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - today.getTime()) / DAY);
}

/**
 * What to say beside an attached document, given the date printed on it.
 *
 * Null for a document with no expiry — an ID copy, a statement of results, a
 * photograph of a safe. That is not silence about a problem; there is no date
 * to have a problem with, and inventing a warning for one would be crying wolf
 * on most of a pack.
 */
export function uploadCaution(
  expiresOn: string | null,
  today: Date,
): UploadCaution | null {
  if (!expiresOn) return null;
  const left = daysUntilDay(expiresOn, today);
  if (left === null) return null;

  if (left < 0) {
    return {
      tone: 'red',
      text: `This expired on ${expiresOn} — replace it before you lodge, because a DFO checks this date first.`,
    };
  }
  if (left < ROW_CAUTION_DAYS) {
    return {
      tone: 'amber',
      text: `This expires on ${expiresOn}, inside three months — SAPS takes longer than that, so renew it before you lodge.`,
    };
  }
  return null;
}

/**
 * The expiry keys an extraction may carry, in the order we trust them.
 *
 * ⚠️ THE VAULT'S OWN COLUMN BEATS ALL OF THESE and is applied by the caller.
 * These are the fallback for a document photographed straight onto the
 * application, which has no vault row behind it and therefore no curated date.
 */
const EXPIRY_KEYS = ['expires_on', 'expiry_date', 'valid_until', 'expires'];

/** yyyy-mm-dd exactly. Anything else is not a date we will act on. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The expiry a reading carries, if it carries one we can stand behind.
 *
 * ⚠️ STRICT yyyy-mm-dd, DELIBERATELY. Vision returns "2027" and "June 2027"
 * often enough, and a partial date coerced into a full one is a deadline we
 * invented. Absent stays absent — which is a different thing from wrong.
 */
export function expiryFromReading(
  values: Record<string, string> | null,
): string | null {
  if (!values) return null;
  for (const k of EXPIRY_KEYS) {
    const v = (values[k] ?? '').trim();
    if (ISO_DAY.test(v)) return v;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// DOES THIS COMPETENCY ACTUALLY COVER THE FIREARM BEING APPLIED FOR?
//
// H10. Auto-link grouped competency candidates by KIND and nothing else, so a
// member holding a handgun-only competency had it attached, unasked, to a
// rifle application. That is not a near miss: a licence application in a
// firearm type the competency does not cover is refused before it is
// considered, and the pack we assembled is the thing that says so.
//
// The endorsements have always been readable — parseEndorsements has been in
// common/sa-competency since the competency work — and nothing asked.
// ────────────────────────────────────────────────────────────────────

/**
 * May this competency certificate be attached to an application needing
 * `needed`?
 *
 * ⚠️ UNKNOWN IS A YES, AND THAT IS NOT LAXITY. Three separate things can be
 * unknown here — the application has not said what firearm it is for, the
 * certificate's `covers` line was never read, or it was read and parsed to
 * nothing. In every one of those cases we do not know that the certificate is
 * wrong, and refusing on a fact we do not hold would withhold the member's own
 * document from their own application on a guess. We refuse only when we have
 * read the endorsements AND they demonstrably do not include the one needed.
 *
 * @param covers   the certificate's own `covers` wording, as read off it.
 * @param needed   the endorsement this application's firearm requires, or null
 *                 when the applicant has not described the firearm yet.
 */
export function competencyCovers(
  covers: string,
  needed: Endorsement | null,
): boolean {
  if (!needed) return true;
  const held = parseEndorsements(covers ?? '');
  if (!held.length) return true;
  return held.includes(needed);
}

/** The kinds whose attachment is decided by the endorsement test above. */
export const ENDORSEMENT_GATED: ReadonlySet<MotivationUploadKind> = new Set([
  MotivationUploadKind.COMPETENCY_CERTIFICATE,
]);
