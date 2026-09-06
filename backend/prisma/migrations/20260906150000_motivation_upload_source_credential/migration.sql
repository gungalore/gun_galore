-- Where an attached document came from, and what happened to its source.
--
-- ADDITIVE ONLY. Two nullable columns on MotivationUpload, one defaulted array
-- on Motivation, one index and one foreign key. Nothing is dropped, nothing
-- changes type, and every existing row reads correctly with NULL / '{}'.
--
-- ⚠️ HAND-WRITTEN, NOT `prisma migrate diff`. The raw diff also wants to DROP
-- the tsvector columns three services add at boot (AskGgKbEntry.searchTsv,
-- HuntPdfPage.textTsv, ReloadingManualPage.textTsv) and would silently destroy
-- full-text search on three tables. See CLAUDE.md, [BC-SCHEMA-DRIFT].

-- ── MotivationUpload.sourceCredentialId ────────────────────────────────────
--
-- Which Document Centre row this copy was taken from. addFromLibrary knew it
-- and threw it away, so nothing downstream could answer "is the document
-- behind this page still in my Centre" — or, for auto-link, "have we offered
-- this exact row before".
ALTER TABLE "MotivationUpload" ADD COLUMN "sourceCredentialId" TEXT;

-- ⚠️ ON DELETE SET NULL, NEVER CASCADE. The bytes on the MotivationUpload row
-- are the applicant's own copy — addFromLibrary mints a fresh storageKey and
-- never shares one — so cascading a vault deletion would pull evidence out of a
-- pack a DFO is holding because somebody tidied their Document Centre.
ALTER TABLE "MotivationUpload"
  ADD CONSTRAINT "MotivationUpload_sourceCredentialId_fkey"
  FOREIGN KEY ("sourceCredentialId") REFERENCES "Credential"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The auto-link's "have we had this one already" question, and the predicate
-- the vault-side delete propagation will sweep on.
CREATE INDEX "MotivationUpload_sourceCredentialId_idx"
  ON "MotivationUpload"("sourceCredentialId");

-- ── MotivationUpload.sourceRemovedAt ───────────────────────────────────────
--
-- When the Centre document behind this copy was deleted. The copy stays good;
-- the member simply has one fewer place to check it against. Surfaced on the
-- row, never as an error. Written by the Document Centre's remove(), which
-- owns the delete and stamps every copy before the row goes.
ALTER TABLE "MotivationUpload" ADD COLUMN "sourceRemovedAt" TIMESTAMP(3);

-- ── Motivation.autolinkSkippedIds ──────────────────────────────────────────
--
-- ⚠️ autolinkedAt STOPPED BEING ENOUGH THE DAY THE RUN COULD RE-ARM. It is
-- cleared when a member adds or confirms a Credential, so a draft looks at the
-- vault again — and auto-link skips only a kind that is ALREADY ATTACHED, so a
-- document the member deleted is no longer attached and comes straight back.
-- That is the "why can't I delete the proof of address?" bug, re-opened.
--
-- A removed MotivationUpload row is hard-deleted, taking its
-- sourceCredentialId with it, so the refusal cannot be derived from what
-- survives. This is the record that outlives the row.
--
-- '{}' is correct for every existing row: nothing has been removed under the
-- re-arm, because until this migration there was no re-arm.
ALTER TABLE "Motivation"
  ADD COLUMN "autolinkSkippedIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
