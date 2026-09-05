-- WHY A CREDENTIAL NEEDS CHECKING, KEPT BEYOND ONE PAGE LOAD.
--
-- The reader already returns which fields it was unsure of and what it
-- repaired, and both went into the CREATE RESPONSE only. A member who
-- refreshed the Document Centre lost the distinction entirely: every row that
-- was not confirmed read "check this" identically, so the two documents that
-- genuinely needed eyes were invisible among the ten that did not.
--
-- This is the same failure `autoFiled` and `namedConfident` were added to fix
-- in August, one field later. Same remedy: store the answer.
--
-- Both are field KEYS / plain sentences in the CLEAR, matching
-- "extractedFields" alongside them -- the values they refer to stay inside
-- detailsEncrypted. Nothing here names a licence number, a serial or an
-- identity number; "readUncertain" holds things like 'covers', and
-- "readNotes" holds our own words about what we changed.
--
-- Additive, defaulted, no backfill: an existing row simply has nothing
-- recorded, which reads as "nothing was doubted" -- correct, because nothing
-- was recorded for it either way and the member has already been through
-- whatever review it needed.

ALTER TABLE "Credential"
  ADD COLUMN "readUncertain" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "readNotes"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
