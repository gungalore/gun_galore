-- ⚠️ DATED 20260828 DELIBERATELY, THOUGH IT WAS WRITTEN ON THE 27th.
-- The migration before it is named `20260827_offers_on_any_listing` — no time
-- component — and an underscore sorts AFTER every digit, so any 20260827HHMMSS
-- folder lands BEFORE it in the directory order Prisma applies. That one is
-- already applied in production and cannot be renamed; this one had not been
-- applied anywhere, so it moves instead. Name new migrations with a full
-- timestamp and this cannot happen again.

-- The member's own name for one motivation, so a Section 13 self-defence
-- application can be told apart from two Section 16 dedicated-hunter ones
-- without opening each. Operator, board review 2026-08-27: "User must be
-- able to rename the motivation."
--
-- NULLABLE, NO DEFAULT. Purely organisational — it is never read into
-- answersEncrypted, documentTextEncrypted or the rendered PDF, and it is not
-- shown to the Registrar. Existing rows start unnamed and the UI falls back
-- to the section label, the same as before this column existed.
ALTER TABLE "Motivation" ADD COLUMN "label" VARCHAR(80);
