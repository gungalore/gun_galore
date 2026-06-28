-- Phase 8a (additive): listing inventory / quantity.
--  trackInventory=false (default) → legacy single-item behavior, unchanged.
--  When true, purchases decrement quantityAvailable via an atomic counter.
ALTER TABLE "Listing"
  ADD COLUMN "trackInventory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "quantityReserved" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Transaction"
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
