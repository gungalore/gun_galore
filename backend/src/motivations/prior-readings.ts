import { MotivationUploadKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHAT WE ALREADY READ OFF THIS MEMBER'S DOCUMENTS, LAST TIME.
//
// Operator, 2026-08-29: "Nothing that is scanned and OCR'd is ever discarded.
// We will use the information to fill out forms an future applications."
//
// The keeping half was already true — a reading is written once at upload and
// cleared only when its document is deleted. The USING half was not: the
// stored extraction was read by exactly one thing, the 117705 check, and a
// member starting a second application retyped everything their first one had
// already read off their ID.
//
// Creation already prefills from two sources, in a deliberate order —
// profile, then vault, then seed. This is the third: what a PREVIOUS
// application read off a document. It sits between profile and vault, because
// a reading beats a profile field the member may have typed years ago and
// loses to the vault, whose documents have been curated in the Centre.
//
// ⚠️ ONLY WHAT DESCRIBES THE PERSON. This is the same cut VAULTABLE makes and
// for the same reason. A competency number is true on every application a
// member ever makes; the firearm they are applying for, where it is coming
// from, and the case they are making are true of ONE application, and copying
// them forward would put last year's answers on this year's form — a false
// statement on a document signed under s120(9)(f), arrived at by helpfulness.
//
// ⚠️ AND THE FIREARM THEY ALREADY OWN IS NOT HERE EITHER, though it looks like
// it belongs. Owned-firearm rows come from the vault's credentialOffer, which
// dedupes them and knows which licence each row came from. Two sources filling
// the same grid would fight, and the reading has no way to tell row 1 from
// row 3 on an application it was never part of.
// ────────────────────────────────────────────────────────────────────

/**
 * The document kinds whose readings stay true past the application they
 * arrived on.
 *
 * Each of these describes the HOLDER. Deliberately narrow: a kind is added
 * here only when its reading would be the same on any application the member
 * ever makes.
 */
export const CARRIES_FORWARD: ReadonlySet<MotivationUploadKind> = new Set([
  MotivationUploadKind.IDENTITY_DOCUMENT,
  MotivationUploadKind.ADDRESS_CONFIRMATION,
  MotivationUploadKind.COMPETENCY_CERTIFICATE,
  MotivationUploadKind.PROFICIENCY_CERTIFICATE,
  MotivationUploadKind.EMPLOYMENT_CONFIRMATION,
  MotivationUploadKind.ASSOCIATION_CARD,
  MotivationUploadKind.GOOD_STANDING_LETTER,
]);

/** One stored reading, as it comes back from the database. */
export interface StoredReading {
  kind: MotivationUploadKind;
  createdAt: Date;
  /** Decrypted extraction — field key to what we read. */
  values: Record<string, string> | null;
}

/**
 * The keys that carry the date PRINTED on the document, in the order we trust
 * them.
 *
 * ⚠️ THE ISSUE DATE, NEVER THE EXPIRY. "Which of these two readings is the
 * current one" is a question about when the document was written, and an
 * expiry answers a different one: a five-year licence issued in 2019 outlives a
 * one-year letter issued last month, and ordering by expiry would let the older
 * document overwrite the newer member's address.
 */
const PRINTED_DAY_KEYS = [
  'issue_date',
  'issued_on',
  'statement_date',
  'date_of_issue',
];

/** yyyy-mm-dd exactly. A partial date is not a date we will order on. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day this reading speaks for: what the document itself says, else when we
 * filed it.
 *
 * ⚠️ createdAt IS WHEN WE SAW IT, NOT WHEN IT WAS TRUE. A member who moved
 * house in March and only got round to photographing the OLD municipal bill in
 * July has two address readings, and the row order puts the stale one last —
 * so the fold below, which is newest-wins, adopts the address they left. The
 * date on the page is the fact; the upload time is an accident of when
 * somebody found their phone.
 *
 * ⚠️ AND A MISSING OR PARTIAL DATE FALLS BACK RATHER THAN SORTING FIRST.
 * Vision returns "2027" and "June 2027" often enough; coercing one into a full
 * day would be inventing the very fact we are ordering on. createdAt is a
 * weaker answer than the page, and a much better one than a guess.
 */
export function effectiveDay(row: StoredReading): Date {
  for (const k of PRINTED_DAY_KEYS) {
    const v = (row.values?.[k] ?? '').trim();
    if (!ISO_DAY.test(v)) continue;
    const t = Date.parse(`${v}T00:00:00Z`);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return row.createdAt;
}

/**
 * Fold a member's past readings into one set of answers to open with.
 *
 * ⚠️ NEWEST WINS, AND THE ORDER MUST NOT COME FROM THE QUERY. A member who
 * moved house has two address readings; the one that is true is the later
 * one. Sorting here rather than trusting the caller means a change of
 * `orderBy` cannot silently start serving the older address.
 *
 * ⚠️ AND "LATER" MEANS LATER ON THE PAGE — see effectiveDay.
 *
 * ⚠️ AN EMPTY STRING IS NOT AN ANSWER. Extraction returns '' for a field it
 * looked for and did not find, and letting that through would overwrite a
 * good older reading with a blank.
 */
export function priorReadings(rows: readonly StoredReading[]): {
  values: Record<string, string>;
  /** Which kind each value came from, for the provenance chip. */
  from: Record<string, MotivationUploadKind>;
} {
  const values: Record<string, string> = {};
  const from: Record<string, MotivationUploadKind> = {};

  const usable = rows
    .filter((r) => CARRIES_FORWARD.has(r.kind) && r.values)
    .slice()
    .sort((a, b) => effectiveDay(a).getTime() - effectiveDay(b).getTime());

  for (const row of usable) {
    for (const [key, value] of Object.entries(row.values ?? {})) {
      const trimmed = (value ?? '').trim();
      if (!trimmed) continue;
      values[key] = trimmed;
      from[key] = row.kind;
    }
  }

  return { values, from };
}

// ────────────────────────────────────────────────────────────────────
// WHAT THEY TOLD US LAST TIME, ON A FORM THEY SIGNED.
//
// H12. A member's SECOND application asks the same thirty-odd criminal-history
// questions as their first, plus four about the safe they already described,
// and offered nothing for any of them. That is the longest, dullest and most
// off-putting stretch of the wizard, and every answer in it was already on
// file — given by the same person, about the same person, weeks earlier.
//
// ⚠️ THIS IS A DIFFERENT CUT FROM CARRIES_FORWARD ABOVE, AND THE DIFFERENCE
// MATTERS. That set is what a DOCUMENT said; this is what the MEMBER said. A
// reading can be a misread digit and is offered for that reason; an answer they
// typed and signed under s120(9)(f) is theirs, and re-offering it is closer to
// showing somebody their own last form than to filling anything in for them.
//
// ⚠️ AND IT IS A PREFILL, NOT A CARRY-OVER. Every one of these lands as an
// ordinary offer: it never overwrites, it is stamped with a provenance chip
// that says where it came from, and it sits in an editable box on a form the
// member reads before signing. Somebody convicted since their last application
// changes the answer, exactly as they would have changed a blank.
//
// ⚠️ NOTHING ABOUT THIS FIREARM, THIS PURCHASE OR THIS CASE — the same line
// CARRIES_FORWARD draws, for the same reason. The safe is the edge: it is a
// fixed installation at a dwelling and is therefore about the PERSON's
// premises, not about the gun. If they have moved, the address question they
// have already answered on this form is what tells them to look at it.
// ────────────────────────────────────────────────────────────────────

/** The four boxes that describe the safe itself. */
const SAFE_ANSWERS = [
  'safe_type',
  'safe_mounted',
  'safe_mounted_to',
  'safe_storage_detail',
] as const;

/**
 * Answers that stay true from one application to the next.
 *
 * ⚠️ MATCHED BY PREFIX FOR THE HISTORY BLOCK, DELIBERATELY. There are
 * thirty-odd `history_*` keys — a Yes/No, a detail, a station, a case number, a
 * charge and an outcome for each of six questions — and they are added to over
 * time. An explicit list would be right on the day it was written and would
 * silently stop covering the next question somebody adds, which is the failure
 * that is invisible: the member simply retypes one more box than last time and
 * nobody ever knows the list went stale.
 *
 * The prefix is safe because the registry owns it: every `history_*` key is
 * part of the SAPS 271's Part D declaration, all of which is about the person.
 */
export function carriesForwardAsAnswer(key: string): boolean {
  return (
    key.startsWith('history_') ||
    (SAFE_ANSWERS as readonly string[]).includes(key)
  );
}

/**
 * Fold the answers from a member's PREVIOUS applications into a set to open
 * with.
 *
 * ⚠️ NEWEST WINS, AND THE CALLER MUST NOT DECIDE THAT EITHER. Same rule as
 * priorReadings: sorted here rather than trusted from an `orderBy`, so a query
 * change cannot silently start serving an application from two years ago.
 *
 * ⚠️ AN EMPTY STRING IS NOT AN ANSWER. A key present and blank is a question
 * they skipped, and letting it through would overwrite a good older answer with
 * a blank — the exact bug the readings fold already guards against.
 *
 * @param rows  one entry per previous application, answers already decrypted.
 */
export function priorAnswers(
  rows: readonly { createdAt: Date; answers: Record<string, string> | null }[],
): {
  values: Record<string, string>;
  /** Every key we filled, so the caller can stamp one provenance over them. */
  keys: string[];
} {
  const values: Record<string, string> = {};
  const usable = rows
    .filter((r) => r.answers)
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const row of usable) {
    for (const [key, value] of Object.entries(row.answers ?? {})) {
      if (!carriesForwardAsAnswer(key)) continue;
      const trimmed = (value ?? '').trim();
      if (!trimmed) continue;
      values[key] = trimmed;
    }
  }

  return { values, keys: Object.keys(values) };
}
