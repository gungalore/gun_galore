-- THE LICENCE & COMPETENCY CENTRE.
--
-- Operator, 2026-08-19: "a licence and competency centre on its own, where
-- people can keep and upload their licences and competencies, so it can be
-- kept book of and tracked for expiry. This way we can have recurring income."
--
-- A member's own documents, encrypted on our own disk, with expiry tracked.
-- Renewals recur by statute, so the demand recurs forever; the reminder lands
-- and one tap opens a pre-filled section 24 renewal motivation.
--
-- WHAT IS IN THE CLEAR, AND WHY IT IS SAFE:
--   issuedOn / expiresOn / confirmedAt — the nightly sweep queries on these,
--   and encrypting them would mean decrypting every row every night. A date on
--   its own identifies nobody. Every identifying value (licence number,
--   holder, make, calibre, serials) is inside "detailsEncrypted", AES-256-GCM
--   under the same ID_HASH_SECRET-derived key as the motivation uploads.
--   "title" is the member's own label for the document; the UI warns against
--   putting a serial in it.
--
-- WHY FIVE TIMESTAMP COLUMNS INSTEAD OF ONE ARRAY OF STAGE NAMES:
--   the plan called for `reminderStagesSent String[]`, and it cannot work.
--   Postgres via Prisma cannot express "array does not contain X" atomically
--   in an updateMany where-clause, so the array cannot be CAS-claimed, and two
--   overlapping sweeps would each read "not sent" and each send. A nullable
--   timestamp per stage gives the exact claim every other reminder in this
--   codebase uses: UPDATE ... WHERE id = $1 AND col IS NULL.
--
-- THE UNIQUE INDEX IS SCOPED TO THE MEMBER, and it is on the BYTES: two people
-- may legitimately hold copies of the same document, and the same person must
-- not be able to file one file twice.
--
-- Vault bytes are DUPLICATED from motivation uploads, never shared. A
-- motivation upload purges on the writer's clock; a vault document lives as
-- long as the account. Sharing one row would let either purge take the other's
-- file.

DO $$ BEGIN
  CREATE TYPE "CredentialKind" AS ENUM (
    'FIREARM_LICENCE',
    'COMPETENCY_CERTIFICATE',
    'DEDICATED_STATUS',
    'PROFICIENCY',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Credential" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "kind"                "CredentialKind" NOT NULL,
  "title"               TEXT NOT NULL,
  "detailsEncrypted"    TEXT,
  "issuedOn"            TIMESTAMP(3),
  "expiresOn"           TIMESTAMP(3),
  "confirmedAt"         TIMESTAMP(3),
  "storageKey"          TEXT,
  "mimeType"            TEXT NOT NULL,
  "byteSize"            INTEGER NOT NULL,
  "sha256"              TEXT NOT NULL,
  "extractionEncrypted" TEXT,
  "extractionOk"        BOOLEAN NOT NULL DEFAULT false,
  "extractedFields"     TEXT[],
  "remind180SentAt"     TIMESTAMP(3),
  "remind120SentAt"     TIMESTAMP(3),
  "remind100SentAt"     TIMESTAMP(3),
  "remind30SentAt"      TIMESTAMP(3),
  "remindD0SentAt"      TIMESTAMP(3),
  "remindersMuted"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  "purgedAt"            TIMESTAMP(3),
  CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Credential_userId_sha256_key"
  ON "Credential" ("userId", "sha256");
CREATE INDEX IF NOT EXISTS "Credential_userId_idx"
  ON "Credential" ("userId");
CREATE INDEX IF NOT EXISTS "Credential_expiresOn_idx"
  ON "Credential" ("expiresOn");
-- The reminder sweep's exact predicate.
CREATE INDEX IF NOT EXISTS "Credential_confirmedAt_remindersMuted_expiresOn_idx"
  ON "Credential" ("confirmedAt", "remindersMuted", "expiresOn");

DO $$ BEGIN
  ALTER TABLE "Credential"
    ADD CONSTRAINT "Credential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
