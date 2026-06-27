-- Phase 3b (additive): fraud-risk signals on Transaction. Computed after
-- payment capture (log-only); never blocks the money path.
ALTER TABLE "Transaction"
  ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "riskFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
