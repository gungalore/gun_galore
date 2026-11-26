-- 2026-11 auction settlement markers (audit M4).
--
-- Additive only. `auctionSettledAt` is stamped once the post-commit settlement
-- pass for an ended auction (strike, notices, runner-up invite) has completed,
-- so the every-minute recovery sweep can replay a settlement that a crash
-- interrupted. `winnerStruckAt` is the CAS claim that makes the non-payment
-- strike exactly-once across those replays.
ALTER TABLE "Listing" ADD COLUMN "auctionSettledAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "winnerStruckAt" TIMESTAMP(3);
