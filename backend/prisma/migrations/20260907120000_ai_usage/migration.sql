-- AiUsage — one row per model call, written by LlmService.
--
-- HAND-WRITTEN, NOT `prisma migrate diff`. See [BC-SCHEMA-DRIFT] in
-- LAUNCH-CHECKLIST.md: three services (Ask GG KB, reloading-manual FTS,
-- listings FTS) add tsvector GENERATED columns and GIN indexes at boot via
-- raw DDL, and those columns are not declared in schema.prisma. A generated
-- diff would see them as drift and emit DROPs for them.
--
-- Purely ADDITIVE: one new table and two new indexes. No existing table,
-- column, constraint or index is touched, so there is nothing to back-fill
-- and nothing to roll back beyond a DROP TABLE.

CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- Spend today / this month / last 30 days on /admin/credits.
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- The per-purpose breakdown, which is the reason this table exists.
CREATE INDEX "AiUsage_purpose_createdAt_idx" ON "AiUsage"("purpose", "createdAt");
