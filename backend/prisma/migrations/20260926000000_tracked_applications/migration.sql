-- THE SAPS APPLICATION TRACKER'S TWO TABLES.
--
-- ADDITIVE ONLY: one enum, two tables, four indexes, two foreign keys. Nothing
-- that already exists is touched. Hand-written in the vault_event house style
-- rather than generated, because the database is not reachable from here.
--
-- ⚠️ `referenceEncrypted` IS CIPHERTEXT AND `referenceHash` IS NOT, AND BOTH
-- ARE LOAD-BEARING. The hash — HMAC-SHA256 keyed from ID_HASH_SECRET — is what
-- the unique index and every lookup match on, so the plaintext reference is
-- never a query key and never sits in an index. The ciphertext (AES-256-GCM)
-- is decrypted at poll time and at no other time. Neither is a candidate for
-- "just store it plainly, it is only an application number".
--
-- ⚠️ THE UNIQUE INDEX IS PER MEMBER, NOT GLOBAL. `@@unique([userId,
-- referenceHash])` stops one member tracking the same application twice; it
-- must NOT stop two members tracking the same application, which is the
-- ordinary case for two people in one household.
--
-- ⚠️ `status` AND `lastOutcome` ARE DIFFERENT COLUMNS ON PURPOSE. `status` is
-- the last real thing SAPS said; `lastOutcome` is what the last POLL did
-- ('unknown' | 'row' | 'no_records' | 'error'). A poll that errors or holds no
-- record must not blank `status` — the page drops a record for a minute at a
-- time under load, and a member who saw APPROVED yesterday must not be shown
-- "unknown" because a request timed out.
--
-- ⚠️ `sapsUpdatedOn` IS NOT `lastCheckedAt`. The first is the "records were
-- updated on" date SAPS prints, i.e. how stale its own answer is; the second
-- is when we asked. The card prints the first, so a member can tell "SAPS says
-- APPROVED" from "SAPS said APPROVED three weeks ago".

CREATE TYPE "TrackedApplicationKind" AS ENUM ('COMPETENCY', 'FIREARM_LICENCE', 'RENEWAL');

CREATE TABLE "TrackedApplication" (
  "id"                 TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "kind"               "TrackedApplicationKind" NOT NULL,
  "referenceEncrypted" TEXT NOT NULL,
  "referenceHash"      TEXT NOT NULL,
  "serialEncrypted"    TEXT,
  "label"              TEXT,
  "submittedOn"        TIMESTAMP(3),
  "applicationType"    TEXT,
  "applicationNumber"  TEXT,
  "calibre"            TEXT,
  "make"               TEXT,
  "serialSeen"         TEXT,
  "status"             TEXT,
  "statusDate"         TIMESTAMP(3),
  "sapsUpdatedOn"      TIMESTAMP(3),
  "lastCheckedAt"      TIMESTAMP(3),
  "lastOutcome"        TEXT NOT NULL DEFAULT 'unknown',
  "lastError"          TEXT,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackedApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackedApplication_userId_referenceHash_key" ON "TrackedApplication"("userId", "referenceHash");
CREATE INDEX "TrackedApplication_active_lastCheckedAt_idx" ON "TrackedApplication"("active", "lastCheckedAt");
CREATE INDEX "TrackedApplication_userId_idx" ON "TrackedApplication"("userId");

ALTER TABLE "TrackedApplication" ADD CONSTRAINT "TrackedApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One observed change, and ONLY one that changed something: a tracker polled
-- for a year has as many of these as it had transitions, not 365 rows.
--
-- ⚠️ EVERY FIELD HERE IS A COPY, NOT A POINTER. The point of the row is to show
-- what the page USED to say, so it may not be re-derived from the tracker.
CREATE TABLE "TrackedApplicationEvent" (
  "id"                TEXT NOT NULL,
  "trackedId"         TEXT NOT NULL,
  "source"            TEXT NOT NULL,
  "observedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"            TEXT,
  "statusDate"        TIMESTAMP(3),
  "applicationType"   TEXT,
  "applicationNumber" TEXT,
  "calibre"           TEXT,
  "make"              TEXT,
  "serial"            TEXT,
  "statusDescription" TEXT,
  "nextStep"          TEXT,
  "rowSha256"         TEXT,
  CONSTRAINT "TrackedApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackedApplicationEvent_trackedId_observedAt_idx" ON "TrackedApplicationEvent"("trackedId", "observedAt");

ALTER TABLE "TrackedApplicationEvent" ADD CONSTRAINT "TrackedApplicationEvent_trackedId_fkey" FOREIGN KEY ("trackedId") REFERENCES "TrackedApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
