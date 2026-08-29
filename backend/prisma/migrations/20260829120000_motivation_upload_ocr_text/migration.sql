-- KEEP WHAT WE READ OFF THE DOCUMENT.
--
-- Operator, 2026-08-29: "is it possible to OCR all documents and keep the raw
-- files, then design a library of keywords to identify them and place them
-- where they need to be?"
--
-- The library landed first (backend/src/common/document-markers.ts). This is
-- the other half: the text itself, kept past the request that read it, so the
-- markers can be re-run over documents already uploaded without paying Google
-- to read the same page again — and so a member can be shown what we actually
-- read, rather than only what we concluded.
--
-- Both columns are NULLABLE and nothing is backfilled. Every row that exists
-- today was read during its own request and the text discarded; there is no
-- honest value to write. NULL means "we do not hold the text for this one",
-- which is true, and re-reading it is a deliberate act, not a migration.

-- ⚠️ ENCRYPTED AT THE APPLICATION LAYER, like extractionEncrypted beside it.
-- This is the FULL text of an identity document or a licence — name, identity
-- number, address, every serial on the page — and strictly more sensitive
-- than the handful of fields we ask the model for. Never SELECT it into a
-- list, a log line or an admin table.
ALTER TABLE "MotivationUpload" ADD COLUMN "ocrTextEncrypted" TEXT;

-- Safe in the clear: a count, not content. It separates "we read this and the
-- page was blank" from "we have not read this", which is otherwise
-- indistinguishable without decrypting to find out.
ALTER TABLE "MotivationUpload" ADD COLUMN "ocrChars" INTEGER;
