-- WHERE A DOCUMENT CAME FROM, AND WHO DECIDES WHETHER IT EXPIRES.
--
-- The first migration that may REFERENCE the values added by the previous one.

-- ── provenance ────────────────────────────────────────────────────────────
-- 'member' | 'scan' | 'application' | 'kyc'. Drives the removal copy, which
-- differs between a document somebody filed here by hand and one we copied out
-- of an application or a verification on their say-so — and it is the one
-- number that says whether the consent window is doing anything at all.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "addedVia" VARCHAR(16);
-- MO000123, where addedVia = 'application'. What the member is shown when they
-- ask why a document they never filed here is sitting in their list.
--
-- ⚠️ NOT A FOREIGN KEY. A motivation is deleted by its own retention; an FK
-- would either block that or null this. It is a reference number printed on a
-- PDF, not a pointer.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "addedForRef" VARCHAR(16);

-- Grouping the Centre by kind, and the adoption path's per-kind counts.
CREATE INDEX IF NOT EXISTS "Credential_userId_kind_idx" ON "Credential"("userId", "kind");

-- ── THE MEMBER SAYS WHETHER IT EXPIRES, NOT THE ENUM ──────────────────────
--
-- Operator, 2026-08-22: "put a tick box next to the expiry date called Never
-- Expires. Also a tickbox next to Issue date called Not Sure, if its unsure
-- when the document was issued."
--
-- ⚠️ THIS REPLACES A CONSTRAINT THAT WOULD HAVE BEEN WRONG, and the case that
-- breaks it is ordinary. The first draft of this migration forbade an
-- expiresOn on eight "person" kinds outright, IDENTITY_DOCUMENT among them —
-- on the reasoning that an ID does not expire. A PASSPORT IS AN IDENTITY
-- DOCUMENT AND IT EXPIRES, and the Centre's own classifier prompt says so:
-- "the green barcoded book, the smart ID card, or the photo page of a
-- passport". A member filing a passport would have hit a database error with
-- no way round it.
--
-- Deciding it from the kind was the mistake. The member is holding the
-- document; they can see whether there is a date on it. So these two columns
-- record what they said, and the CHECKs keep each answer internally
-- consistent rather than second-guessing which documents are allowed a date.
--
-- The reminder sweep is unaffected either way: it requires expiresOn AND
-- confirmedAt, and a never-expires row carries neither.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "neverExpires" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "issuedOnUnknown" BOOLEAN NOT NULL DEFAULT false;

-- A tick and a date are contradictory answers to the same question. Storing
-- both means every reader has to decide which one wins, and they will not all
-- decide the same way.
--
-- ⚠️ PRISMA DOES NOT MODEL CHECK CONSTRAINTS. Neither will appear in
-- schema.prisma and `prisma migrate diff` cannot see them; if the migration
-- baseline is ever reset they must be re-added by hand.
ALTER TABLE "Credential" DROP CONSTRAINT IF EXISTS "Credential_person_kinds_have_no_expiry";
ALTER TABLE "Credential" DROP CONSTRAINT IF EXISTS "Credential_never_expires_has_no_date";
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_never_expires_has_no_date"
  CHECK (NOT "neverExpires" OR "expiresOn" IS NULL);
ALTER TABLE "Credential" DROP CONSTRAINT IF EXISTS "Credential_unknown_issue_has_no_date";
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_unknown_issue_has_no_date"
  CHECK (NOT "issuedOnUnknown" OR "issuedOn" IS NULL);
