-- One-pass document capture: every printed fact + the page text.
ALTER TABLE "MotivationUpload"
  ADD COLUMN "captureEncrypted" TEXT,
  ADD COLUMN "captureVersion" VARCHAR(40),
  ADD COLUMN "captureAt" TIMESTAMP(3);

ALTER TABLE "Credential"
  ADD COLUMN "captureEncrypted" TEXT,
  ADD COLUMN "captureVersion" VARCHAR(40),
  ADD COLUMN "captureAt" TIMESTAMP(3);

ALTER TABLE "DocumentIdentify"
  ADD COLUMN "captureEncrypted" TEXT;
