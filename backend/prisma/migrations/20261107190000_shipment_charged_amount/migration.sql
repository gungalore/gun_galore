-- What the carrier actually billed, recorded beside the quote the buyer paid.
--
-- `shippingCost` is the checkout snapshot and is never mutated: it is what the
-- buyer's Delivery line says and what the Books freight journal posts. Bob Go
-- bills the wallet at collection, and a re-weigh can move that figure. These
-- nullable columns record the real charge so the desk can see the pair instead
-- of only an alert string, and so a repeated webhook does not re-alert the same
-- variance.
--
-- Nullable and defaultless on purpose: NULL means "the carrier has not told us
-- yet", which is different from 0 ("the carrier billed nothing").

ALTER TABLE "Transaction" ADD COLUMN "shipmentChargedCents" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "shipmentChargedAt" TIMESTAMP(3);
