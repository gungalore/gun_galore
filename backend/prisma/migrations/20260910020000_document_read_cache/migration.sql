-- A document we have already paid to read.
--
-- The AiUsage ledger carried exactly ten motivation.extract.current_licence
-- calls and four proficiency_certificate calls, repeated six times over three
-- days against the same stored files: 60 model calls that should have been 10.
-- Every pick of a vault document into a pack re-read the bytes from scratch.
--
-- Additive only. No column on an existing table changes.
CREATE TABLE "DocumentReadCache" (
    "id" TEXT NOT NULL,
    "cacheKey" VARCHAR(200) NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "payloadEncrypted" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentReadCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentReadCache_cacheKey_key" ON "DocumentReadCache"("cacheKey");
CREATE INDEX "DocumentReadCache_expiresAt_idx" ON "DocumentReadCache"("expiresAt");
CREATE INDEX "DocumentReadCache_fileSha256_idx" ON "DocumentReadCache"("fileSha256");
