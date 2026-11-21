-- Silent generation failures with an automatic rebuild.
--
-- Operator, 2026-11-21: "We never let the user know it failed. We fix it and
-- let the system regenerate the motivation and then we notify them it has been
-- processed and ready to download."
--
-- So a failed run leaves the row in NEEDS_MORE_INFO (regenerable, and rendered
-- without failure wording), stamps the attempt count here, and schedules the
-- next automatic attempt. A cron retries with backoff; only a successful run
-- notifies the applicant.
--
-- Additive and nullable/defaulted: every existing row reads as "no failures,
-- no retry pending".

ALTER TABLE "Motivation"
  ADD COLUMN "generationFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "generationRetryAt" TIMESTAMP(3);

CREATE INDEX "Motivation_generationRetryAt_idx"
  ON "Motivation"("generationRetryAt");
