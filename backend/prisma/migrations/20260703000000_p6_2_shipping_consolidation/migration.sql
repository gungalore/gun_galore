-- P6.2 — per-seller shipping consolidation.
-- A "carrier" transaction holds one consolidated shipment; sibling lines point
-- at it via shipsWithId and carry shippingCost 0. Purely additive: one nullable
-- self-FK column + index. Nothing existing is altered or dropped.

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "shipsWithId" TEXT;

-- Self-referential FK: a sibling → its carrier. ON DELETE SET NULL so deleting
-- a carrier row never cascades away a sibling (Prisma default for an optional
-- relation). Guarded so a replay is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_shipsWithId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_shipsWithId_fkey"
      FOREIGN KEY ("shipsWithId") REFERENCES "Transaction"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Transaction_shipsWithId_idx"
  ON "Transaction"("shipsWithId");
