import { CredentialKind } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// WHICH DOCUMENTS RUN OUT, AND WHICH ARE SIMPLY KEPT.
//
// The Document Centre holds two quite different things under one roof, and
// almost every bug in the module comes from treating them the same:
//
//   AN EXPIRING CREDENTIAL — a licence, a competency certificate, a dedicated
//   status. It has a date, the date is the whole point, and the reminder crons
//   exist to chase it.
//
//   A DOCUMENT WE JUST KEEP — an ID copy, a photograph of a safe, proof of
//   address. Nothing about it expires. Asking a member to confirm the expiry
//   date on a photograph of their gun safe is asking a question with no
//   answer, and the module used to do exactly that: every upload went into a
//   confirm queue headed "Check this document" with a required Expires-on
//   field and a primary button reading "That date is right".
//
// ⚠️ THE SET IS THE SOURCE OF TRUTH, NOT A COLUMN. A `noExpiry` boolean on
// the row would duplicate the enum and could therefore disagree with it. The
// kind already says everything.
//
// ⚠️ THE DATABASE ENFORCES THE OTHER HALF. CHECK constraint
// Credential_person_kinds_have_no_expiry makes it impossible for any of the
// eight person kinds to carry an expiresOn at all — so `expiresOn IS NOT NULL`
// is on its own a complete guard in any future reminder query, however it is
// written. Today's sweep is safe because it also requires confirmedAt; that is
// a property of one WHERE clause in one file, and not something to rely on.
//
// PURE — no Nest, no Prisma client, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * The kinds that run out. Everything else has no date to chase.
 *
 * ⚠️ OTHER IS IN HERE ON PURPOSE. It is the catch-all a member files an
 * association card or an insurance schedule under, and some of those do
 * expire — so it keeps the date field and the reminder machinery. It is the
 * one kind where we genuinely do not know, and offering the date is the
 * conservative answer.
 */
export const EXPIRY_TRACKED: ReadonlySet<CredentialKind> = new Set<CredentialKind>([
  CredentialKind.FIREARM_LICENCE,
  CredentialKind.COMPETENCY_CERTIFICATE,
  CredentialKind.DEDICATED_DISCIPLINE,
  CredentialKind.PROFICIENCY,
  CredentialKind.OTHER,
  // Retired kinds. Rows filed before the consolidation still carry them and
  // still have real dates being chased.
  CredentialKind.DEDICATED_STATUS,
  CredentialKind.DEDICATED_HUNTER,
  CredentialKind.PROFESSIONAL_HUNTER,
  CredentialKind.GOOD_STANDING,
]);

/** Does this kind have an expiry worth chasing? */
export function tracksExpiry(kind: CredentialKind): boolean {
  return EXPIRY_TRACKED.has(kind);
}

/**
 * The eight the Document Centre gained when it absorbed the application
 * paperwork. Kept, never chased.
 *
 * ⚠️ DERIVED, not a second hand-written list that can drift out of step with
 * the one above.
 */
export const NO_EXPIRY_KINDS: readonly CredentialKind[] = Object.values(
  CredentialKind,
).filter((k) => !EXPIRY_TRACKED.has(k));

/**
 * Kinds we do NOT spend a vision call on.
 *
 * ⚠️ IT IS THE SAME SET, AND THAT IS NOT A COINCIDENCE. Vision is here to read
 * the dates and numbers printed on a document. There is nothing printed on a
 * photograph of a safe to read, so a call would spend money to come back with
 * nothing and then flag the document amber for having found nothing.
 *
 * ADDRESS_CONFIRMATION is the one that gives pause — it carries a date, and
 * the date decides whether it is fresh enough for a DFO. But that date must
 * never become an `expiresOn` (see the CHECK constraint), so it is read at
 * pick time from what the member confirms, not chased by a cron.
 */
export const NO_VISION_KINDS: readonly CredentialKind[] = NO_EXPIRY_KINDS;
