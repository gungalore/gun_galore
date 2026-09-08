-- Background we looked up once, cached so the next applicant costs nothing.
--
-- HAND-WRITTEN, NOT `prisma migrate diff`. See the schema-drift trap in
-- CLAUDE.md: two services add tsvector GENERATED columns and GIN indexes at
-- boot via raw DDL, and those columns are not declared in schema.prisma. A
-- generated diff reads them as drift and emits DROPs for them.
--
-- Purely ADDITIVE: one new table, one unique index and one lookup index. No
-- existing table, column, constraint or index is touched, so there is nothing
-- to back-fill and nothing to roll back beyond a DROP.
--
-- ⚠️ NO FOREIGN KEY, AND NO USER COLUMN, DELIBERATELY. A row is about a
-- firearm model, a cartridge, a discipline or a class of game — never about a
-- person. It is shared across every applicant who asks the same question, and
-- it is not encrypted because there is nothing personal in it to protect.
--
-- Motivation Centre rebuild, Phase 2 — MOTIVATION-REBUILD-BRIEF.md §5.5.

CREATE TABLE "MotivationResearch" (
    "id" TEXT NOT NULL,
    "target" VARCHAR(24) NOT NULL,
    "cacheKey" VARCHAR(400) NOT NULL,
    "payload" TEXT NOT NULL,
    "sources" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationResearch_pkey" PRIMARY KEY ("id")
);

-- The hit. The service upserts on this, so the constraint is what makes two
-- applications researching the same cartridge at the same moment safe rather
-- than a race that writes two rows.
CREATE UNIQUE INDEX "MotivationResearch_cacheKey_key" ON "MotivationResearch"("cacheKey");

-- For the sweep that clears expired rows, and for counting what we hold per
-- target without a sequential scan.
CREATE INDEX "MotivationResearch_target_expiresAt_idx" ON "MotivationResearch"("target", "expiresAt");
