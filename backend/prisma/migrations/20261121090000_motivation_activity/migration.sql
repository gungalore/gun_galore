-- The motivation support timeline.
--
-- Operator, 2026-11-21: "we need to log every motivation activities so we can
-- pin point every move of the user so we can immediately fix the issue once
-- it's been reported."
--
-- Additive: one new table plus its indexes. Both foreign keys are nullable
-- with ON DELETE SET NULL so the trail survives a POPIA erasure and the
-- retention purge; `motivationRef` snapshots the MO number so the rows remain
-- readable after the document is gone.
--
-- ⚠️ NO SENSITIVE DATA. `detail` is written only through the service's
-- sanitiser, which accepts keys, counts, enum labels and ids — never an answer
-- value, ID number, address or serial.

CREATE TABLE "MotivationActivity" (
  "id" TEXT NOT NULL,
  "motivationId" TEXT,
  "userId" TEXT,
  "motivationRef" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" JSONB,
  "path" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MotivationActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MotivationActivity_motivationId_createdAt_idx"
  ON "MotivationActivity"("motivationId", "createdAt");
CREATE INDEX "MotivationActivity_userId_createdAt_idx"
  ON "MotivationActivity"("userId", "createdAt");
CREATE INDEX "MotivationActivity_action_createdAt_idx"
  ON "MotivationActivity"("action", "createdAt");
CREATE INDEX "MotivationActivity_motivationRef_createdAt_idx"
  ON "MotivationActivity"("motivationRef", "createdAt");

ALTER TABLE "MotivationActivity"
  ADD CONSTRAINT "MotivationActivity_motivationId_fkey"
  FOREIGN KEY ("motivationId") REFERENCES "Motivation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MotivationActivity"
  ADD CONSTRAINT "MotivationActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
