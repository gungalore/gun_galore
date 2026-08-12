-- Ask GG Everywhere — additive only.
-- AskGgMessage: page context (user turns) + support-ticket draft (assistant turns).
-- AskGgKbEntry: stable sourceKey for seeded Help-Centre platform entries.

ALTER TABLE "AskGgMessage" ADD COLUMN "pageContext" JSONB;
ALTER TABLE "AskGgMessage" ADD COLUMN "ticketDraft" JSONB;

ALTER TABLE "AskGgKbEntry" ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "AskGgKbEntry_sourceKey_key" ON "AskGgKbEntry"("sourceKey");
