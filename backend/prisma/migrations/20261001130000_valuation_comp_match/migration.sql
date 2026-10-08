-- Value My Item: record how closely each comp matches the item, so the
-- pricing tiering (exact model / same model different spec / same brand and
-- class) is persisted and auditable.

ALTER TABLE "ValuationComp" ADD COLUMN "matchTier" TEXT;
ALTER TABLE "ValuationComp" ADD COLUMN "specDiffs" JSONB;
