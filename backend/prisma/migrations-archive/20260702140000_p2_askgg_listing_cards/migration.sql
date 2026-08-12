-- P2.2 — Ask GG marketplace lever. Store the live listing cards an answer
-- surfaced (searchMarketplace / getComplements) alongside the message, so a
-- reloaded conversation re-renders the shoppable cards. Additive only.

ALTER TABLE "AskGgMessage" ADD COLUMN IF NOT EXISTS "listingCards" JSONB;
