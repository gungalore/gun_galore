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
 * Fold a member's past readings into one set of answers to open with.
 *
 * ⚠️ NEWEST WINS, AND THE ORDER MUST NOT COME FROM THE QUERY. A member who
 * moved house has two address readings; the one that is true is the later
 * one. Sorting here rather than trusting the caller means a change of
 * `orderBy` cannot silently start serving the older address.
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
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

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
