-- WHERE A DOCUMENT CAME FROM, AND THE GUARD THAT KEEPS THE REMINDERS QUIET.
--
-- The first migration that may REFERENCE the values added by the previous one.

-- ── provenance ────────────────────────────────────────────────────────────
-- 'member' | 'scan' | 'application'. Drives the removal copy, which differs
-- between a document somebody filed here by hand and one we copied out of an
-- application on their say-so — and it is the one number that says whether
-- the consent window is doing anything at all.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "addedVia" VARCHAR(16);
-- MO000123, where addedVia = 'application'. What the member is shown when
-- they ask why a document they never filed here is sitting in their list.
--
-- ⚠️ NOT A FOREIGN KEY. A motivation is deleted by its own retention; an FK
-- would either block that or null this. It is a reference number printed on a
-- PDF, not a pointer.
ALTER TABLE "Credential" ADD COLUMN IF NOT EXISTS "addedForRef" VARCHAR(16);

-- Grouping the Centre by kind, and the adoption path's per-kind counts.
CREATE INDEX IF NOT EXISTS "Credential_userId_kind_idx" ON "Credential"("userId", "kind");

-- ── the guard ─────────────────────────────────────────────────────────────
-- ⚠️ A PHOTOGRAPH OF A SAFE MUST NOT BE ABLE TO CARRY AN EXPIRY DATE.
--
-- The reminder sweep is safe TODAY because it requires both confirmedAt and
-- expiresOn to be non-null, and a dateless row fails twice over. But that is a
-- property of one WHERE clause in one file, and there is no `kind` predicate
-- anywhere in it. The next person to write a reminder query has nothing
-- stopping them.
--
-- With this constraint, `expiresOn IS NOT NULL` is on its own a complete
-- guarantee that a row is an expiring credential, however any future query is
-- written. It is also what makes it safe to relax the confirm step's
-- must-have-a-date rule for these kinds.
--
-- ⚠️ PRISMA DOES NOT MODEL CHECK CONSTRAINTS. It will not appear in
-- schema.prisma and `prisma migrate diff` cannot see it. If the migration
-- baseline is ever reset, this must be re-added by hand.
ALTER TABLE "Credential" DROP CONSTRAINT IF EXISTS "Credential_person_kinds_have_no_expiry";
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_person_kinds_have_no_expiry"
  CHECK ("expiresOn" IS NULL OR "kind" NOT IN (
    'IDENTITY_DOCUMENT', 'ADDRESS_CONFIRMATION', 'EMPLOYMENT_CONFIRMATION',
    'SAFE_PHOTO_CLOSED', 'SAFE_PHOTO_AJAR', 'SAFE_PHOTO_BOLTS',
    'SAFE_INSTALLATION', 'SHOOTING_ACTIVITY_LOG'
  ));
