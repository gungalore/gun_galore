-- EXP-E5 — Raffle prize AS EXPERIENCE: outfitter-sponsored, paid-ticket raffle prize.
-- Additive only (new nullable / defaulted columns on Raffle + RaffleWinner);
-- safe to run against a live prod table with zero backfill. Postgres 16.
--
-- Mirrors prizeIsFirearm exactly: the paid-ticket draw + CPA-s36 free-postal /
-- backup logic reads NEITHER flag, so prizeIsExperience slots beside it with no
-- draw-logic change. ExperienceType + Province enums already exist (EXP-E0).

-- 1) Raffle — experience flag + package metadata (mirroring Listing) + sponsor
--    settlement fields (the FNB payout the vetted outfitter is owed).
ALTER TABLE "Raffle"
  ADD COLUMN IF NOT EXISTS "prizeIsExperience" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "experienceType" "ExperienceType",
  ADD COLUMN IF NOT EXISTS "eventStartDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventEndDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eventProvince" "Province",
  ADD COLUMN IF NOT EXISTS "locationText" TEXT,
  ADD COLUMN IF NOT EXISTS "durationText" TEXT,
  ADD COLUMN IF NOT EXISTS "speciesList" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "whatsIncluded" TEXT,
  ADD COLUMN IF NOT EXISTS "rifleProvided" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sponsorUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "sponsorSettlementCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "sponsorSettledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sponsorSettlementRef" TEXT;

-- 2) RaffleWinner — experience claim evidence (mirroring the firearm attestation
--    columns) + on-site fulfilment stamps (the equivalent of prizeDispatched*).
ALTER TABLE "RaffleWinner"
  ADD COLUMN IF NOT EXISTS "winnerExperienceAttestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "winnerContactConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "winnerPreferredDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceFulfilledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "experienceFulfilledByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceFulfilmentNote" TEXT;
