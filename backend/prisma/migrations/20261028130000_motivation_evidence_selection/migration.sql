-- The four body-evidence uploads chosen for this pack.
ALTER TABLE "Motivation"
  ADD COLUMN "evidenceSelectionEncrypted" TEXT,
  ADD COLUMN "evidenceSelectionVersion" VARCHAR(40),
  ADD COLUMN "evidenceSelectionHash" VARCHAR(64),
  ADD COLUMN "evidenceSelectionAt" TIMESTAMP(3);
