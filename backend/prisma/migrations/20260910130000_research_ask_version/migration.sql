-- Which wording of the research asks produced Motivation.researchEncrypted.
--
-- Without it a fix to an ask can never reach a motivation that already holds
-- research: RESEARCH_ASK_VERSION is in the shared cache key, but the per-row
-- column is frozen at first write and read forever after.
--
-- Left NULL for existing rows on purpose. NULL reads as "older than any
-- version we know", so the next generation re-gathers — which is the point.
ALTER TABLE "Motivation" ADD COLUMN "researchAskVersion" VARCHAR(40);
