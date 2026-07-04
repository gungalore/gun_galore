-- FLOW-F7 (raffle-firearm-prizes): let the data model represent a firearm
-- prize so every downstream gate (dispatch guard, claim-time attestation)
-- can key off it. Additive-only.
--
-- Raffle.prizeIsFirearm — the keystone flag re-introduced after the create
-- toggle was dropped per an earlier spec. When true, the prize must route
-- through the dealer-transfer / SAPS-534 workflow, never a bare courier ref.
ALTER TABLE "Raffle" ADD COLUMN IF NOT EXISTS "prizeIsFirearm" BOOLEAN NOT NULL DEFAULT false;

-- RaffleWinner — persist the winner's per-firearm attestation captured at
-- claim time (18+/licence/dealer-transfer consent). Nullable so non-firearm
-- winners are unaffected and existing rows back-fill cleanly.
ALTER TABLE "RaffleWinner" ADD COLUMN IF NOT EXISTS "winnerAttestedAdultAt" TIMESTAMP(3);
ALTER TABLE "RaffleWinner" ADD COLUMN IF NOT EXISTS "winnerLicenceRef" TEXT;
