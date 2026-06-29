-- SWOP proof-of-possession (anti-phantom-item). Additive — per-leg code +
-- vision-verification state on the Transaction (swap leg). Funding is gated on
-- both legs being APPROVED, so nobody pays or ships for an item that wasn't
-- proven to exist.

ALTER TABLE "Transaction" ADD COLUMN "swapProofCode" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "swapProofPhotoUrl" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "swapProofStatus" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "swapProofScore" DOUBLE PRECISION;
ALTER TABLE "Transaction" ADD COLUMN "swapProofFindings" JSONB;
ALTER TABLE "Transaction" ADD COLUMN "swapProofVerifiedAt" TIMESTAMP(3);
