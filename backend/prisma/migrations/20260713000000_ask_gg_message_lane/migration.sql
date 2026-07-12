-- W6 two-lane quota: which meter a user turn was billed to.
-- Additive + nullable — zero impact on existing rows.
ALTER TABLE "AskGgMessage" ADD COLUMN "lane" TEXT;
