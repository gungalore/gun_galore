-- THE THREE COLUMNS AN EVIDENCE ITEM CARRIES, ON BOTH SIDES OF THE COPY.
--
-- ⚠️ THE SAME THREE ON Credential AND MotivationUpload, DELIBERATELY. The
-- vault row is the master and the motivation row is a copy of it; if they
-- disagree, an item changes page when it is picked into a motivation. One
-- shape, written identically by the vault upload and by addFromLibrary.
--
--   evidenceType                 — a container id from evidence-taxonomy.ts.
--   evidenceConfidence           — 'high' | 'low'.
--   evidenceDescriptionEncrypted — the member's own words, ENCRYPTED.
--
-- ⚠️ evidenceType IS FREE TEXT AND NULL IS MEANINGFUL. The taxonomy is
-- revised by editing a registry file, not by a migration, so an id stored
-- today may not resolve tomorrow; containerById() returns null for it and the
-- item reads as generic evidence. NULL is ALSO the honest answer when the
-- classifier was unsure: a wrong container is worse than none, because
-- `placement` moves the page and `satisfies` ticks a DFO row. So "we could not
-- decide" and "we decided and the answer is this" are the two states, and only
-- the second writes a value.
--
-- ⚠️ THE DESCRIPTION IS ENCRYPTED AND MUST STAY SO. "me and my son on a hunt
-- in Limpopo" names a person, a relationship and a place; a description of a
-- family or home photograph is more identifying than most documents in this
-- table. It is purged with the bytes by the retention sweep, never logged, and
-- delimited in the classifier prompt as untrusted data rather than
-- instruction. POPIA data — do not add a plaintext copy of it anywhere.
--
ALTER TABLE "Credential"
  ADD COLUMN IF NOT EXISTS "evidenceType"                 TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceConfidence"           TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceDescriptionEncrypted" TEXT;

ALTER TABLE "MotivationUpload"
  ADD COLUMN IF NOT EXISTS "evidenceType"                 TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceConfidence"           TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceDescriptionEncrypted" TEXT;

-- ⚠️ THE INDEX COMES AFTER THE COLUMN IT INDEXES. It stood above the two
-- ALTER TABLEs and the migration aborted the first time it was applied to a
-- real database — Postgres computes index attributes immediately, so it
-- reported "column evidenceType does not exist" and left the migration
-- half-applied in a failed state (P3018). Ordering inside a migration is not
-- cosmetic when the whole file runs in one transaction.
--
-- ⚠️ THE INDEX IS WHAT THE RENDER READS BY. The annexure/body split selects
-- uploads where kind = 'EVIDENCE', and then filters in the application by
-- container placement — but the lookup of "which evidence is on this
-- motivation" happens on every pack generation, and the table grows with every
-- application. The index is narrow and cheap.
CREATE INDEX "MotivationUpload_evidenceType_idx"
  ON "MotivationUpload" ("evidenceType");
