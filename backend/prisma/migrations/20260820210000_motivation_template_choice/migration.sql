-- Which template the applicant picked for their motivation.
--
-- Plain VARCHARs rather than enums on purpose: adding a colourway or a format
-- then costs a code deploy and a picker row, never a Postgres migration.
-- ALTER TYPE ... ADD VALUE is one-way and cannot be USED in the transaction
-- that adds it, which is a two-file migration every time.
--
-- Nullable with no default: a row written before the picker existed has no
-- choice recorded, and the renderer falls back to 'standard'/'slate'. A
-- DEFAULT would make those rows claim a choice the applicant never made.
ALTER TABLE "Motivation" ADD COLUMN "templateFormat" VARCHAR(20);
ALTER TABLE "Motivation" ADD COLUMN "templateColourway" VARCHAR(20);
