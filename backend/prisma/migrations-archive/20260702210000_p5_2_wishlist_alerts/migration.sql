-- P5.2 — wishlist alerts (price-drop + item-sold) + seller saved-count nudge.
--
-- Only a single additive column: the price-drop alert throttle. Item-sold
-- alerts ride markPaid's exactly-once SOLD transition (no column needed) and
-- the seller nudge is a read-side _count (no column). Idempotent / additive.

ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "priceDropNotifiedAt" TIMESTAMP(3);
