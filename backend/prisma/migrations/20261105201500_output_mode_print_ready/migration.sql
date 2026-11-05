-- ⚠️ THE PACK IS NAMED PRINT_READY NOW, AND MOTIVATION-ONLY IS THE DEFAULT.
--
-- The generated SAPS 271 is gone, so the old FULL_PACK ("motivation, the
-- completed SAPS 271 and every annexure") no longer describes anything. What it
-- did describe — the motivation plus the lettered annexures and the document
-- checks — is PRINT_READY.
--
-- ⚠️ THE UPDATE IS NOT COSMETIC. Existing rows holding FULL_PACK mean "this
-- member is getting the annexures". Left as-is they would be read by
-- normaliseOutputMode (which still understands the old name), but the column
-- itself would keep a value nothing writes any more, and a later query that
-- filters on PRINT_READY would silently miss every historical pack.

ALTER TABLE "Motivation" ALTER COLUMN "outputMode" SET DEFAULT 'MOTIVATION_ONLY';

UPDATE "Motivation" SET "outputMode" = 'PRINT_READY' WHERE "outputMode" = 'FULL_PACK';
