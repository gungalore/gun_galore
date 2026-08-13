-- M36 — record why a shipment failed, let the seller rebook, and charge them
-- when the failure was theirs.
--
-- Operator rule: a seller who measures a parcel wrong, so it will not fit the
-- collection point, pays the wasted courier charge. They rebook with corrected
-- measurements and the amount comes off what they are paid for the sale.
--
-- failedShipmentChargeCents ACCUMULATES (a second failure adds a second
-- charge) and is subtracted where payouts are computed. It is deliberately not
-- applied by mutating sellerPayout: that column is a point-of-sale snapshot of
-- what buyer and seller agreed, and rewriting it would erase the record of the
-- original deal. Keeping the charge separate also means an admin can see, and
-- reverse, exactly what was deducted and why.
--
-- Reasons live in code (common/shipment-failure-policy.ts) rather than a
-- Postgres enum, matching how Offer.rejectReason already works — the ticklist
-- changes with policy, and policy should not need a migration.
--
-- Safe against production: nullable columns plus two defaulted integers. ADD
-- COLUMN with a constant default is metadata-only on Postgres 11+.

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "shipmentFailureReason"     TEXT,
  ADD COLUMN IF NOT EXISTS "shipmentFailureNote"       TEXT,
  ADD COLUMN IF NOT EXISTS "shipmentFailureAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedShipmentChargeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shipmentRebookCount"       INTEGER NOT NULL DEFAULT 0;
