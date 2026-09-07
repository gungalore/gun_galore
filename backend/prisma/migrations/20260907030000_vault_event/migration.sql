-- The vault's decision ledger.
--
-- ADDITIVE ONLY: one new table, four indexes. Nothing else touched.
-- Hand-written, not `prisma migrate diff` - see CLAUDE.md [BC-SCHEMA-DRIFT].
CREATE TABLE "VaultEvent" (
  "id"           TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"       TEXT,
  "credentialId" TEXT,
  "motivationId" TEXT,
  "stage"        TEXT NOT NULL,
  "outcome"      TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "detail"       JSONB,
  CONSTRAINT "VaultEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VaultEvent_createdAt_idx" ON "VaultEvent"("createdAt");
CREATE INDEX "VaultEvent_stage_code_createdAt_idx" ON "VaultEvent"("stage", "code", "createdAt");
CREATE INDEX "VaultEvent_credentialId_idx" ON "VaultEvent"("credentialId");
CREATE INDEX "VaultEvent_userId_createdAt_idx" ON "VaultEvent"("userId", "createdAt");
