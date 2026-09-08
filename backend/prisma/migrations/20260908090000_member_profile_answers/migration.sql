-- Answers that belong to the PERSON rather than to one application.
--
-- HAND-WRITTEN, NOT `prisma migrate diff`. See the schema-drift trap in
-- CLAUDE.md: two services (the Ask GG KB and the reloading-manual FTS) add
-- tsvector GENERATED columns and GIN indexes at boot via raw DDL, and those
-- columns are not declared in schema.prisma. A generated diff reads them as
-- drift and emits DROPs for them.
--
-- Purely ADDITIVE: one new table, one unique index and one foreign key. No
-- existing table, column, constraint or index is touched, so there is nothing
-- to back-fill and nothing to roll back beyond a DROP.
--
-- Motivation Centre rebuild, Phase 1 — MOTIVATION-REBUILD-BRIEF.md §5.2.

CREATE TABLE "MemberProfileAnswers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answersEncrypted" TEXT,
    "answersSchemaVersion" VARCHAR(40),
    "answerProvenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfileAnswers_pkey" PRIMARY KEY ("id")
);

-- One row per member. The service upserts on this, so the constraint is what
-- makes two concurrent saves safe rather than a race that writes two rows and
-- reads back whichever Postgres happens to return first.
CREATE UNIQUE INDEX "MemberProfileAnswers_userId_key" ON "MemberProfileAnswers"("userId");

-- ON DELETE CASCADE, matching Motivation and Credential: closing an account
-- takes the profile answers with it. POPIA — there is no reason to keep
-- somebody's marital status and the layout of their gun safe after they have
-- gone.
ALTER TABLE "MemberProfileAnswers"
    ADD CONSTRAINT "MemberProfileAnswers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
