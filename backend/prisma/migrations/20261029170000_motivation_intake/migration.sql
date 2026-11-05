-- Guided intake for the motivation creator. Additive only.
ALTER TABLE "Motivation"
  ADD COLUMN "intakeMode" VARCHAR(16),
  ADD COLUMN "intakeStartedAt" TIMESTAMP(3),
  ADD COLUMN "intakeDocumentsAt" TIMESTAMP(3),
  ADD COLUMN "intakeCompletedAt" TIMESTAMP(3),
  ADD COLUMN "interviewEncrypted" TEXT,
  ADD COLUMN "interviewVersion" VARCHAR(24);
