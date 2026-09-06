-- Why a vault row asks to be looked at, and which row it duplicates.
--
-- ADDITIVE ONLY. Two columns on Credential: a text array defaulting to empty
-- and a nullable text. Nothing is dropped, nothing changes type, and every
-- existing row reads correctly as "nothing to look at".
--
-- ⚠️ HAND-WRITTEN, NOT `prisma migrate diff`. The raw diff also wants to DROP
-- the tsvector columns three services add at boot. See CLAUDE.md,
-- [BC-SCHEMA-DRIFT].
--
-- WHY (operator, 2026-09-07): a second scan of the same licence was filed as a
-- second licence, and a proof of address was filed without anyone checking it
-- was the member's or recent. Both now file, and ask.
ALTER TABLE "Credential" ADD COLUMN "attention" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Credential" ADD COLUMN "duplicateOfId" TEXT;
