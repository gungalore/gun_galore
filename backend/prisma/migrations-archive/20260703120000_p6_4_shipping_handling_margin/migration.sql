-- P6.4 — flat GG shipping handling margin (R15 per waybill created).
-- Additive + idempotent. Two new money columns, both defaulting to 0 so every
-- existing row (and every code path that does not set them) is unchanged.
--
-- Transaction.shippingHandlingCents: the R15 buyer-paid, GG-retained margin on
-- a courier line that produces its own waybill. Stored SEPARATELY from
-- shippingCost (which stays the pure carrier rate remitted to Pudo/TCG). Zero
-- for firearm (DEALER_TRANSFER / PRIVATE_ARRANGE), collection, and consolidated
-- sibling lines — none of those book their own waybill.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "shippingHandlingCents" INTEGER NOT NULL DEFAULT 0;

-- Order.handlingSubtotal: sum of the child transactions' shippingHandlingCents,
-- so the Order money snapshot keeps the identity
--   itemsSubtotal + shippingSubtotal + handlingSubtotal + processingFee == buyerTotal.
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "handlingSubtotal" INTEGER NOT NULL DEFAULT 0;
