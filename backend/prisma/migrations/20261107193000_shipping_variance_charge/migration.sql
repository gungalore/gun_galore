-- Courier re-weigh charges are the seller's, not ours.
--
-- When Bob Go re-weighs or re-measures a parcel at collection it accepts it and
-- bills the wallet — the platform cannot refuse the charge. The buyer paid the
-- quoted figure and is not re-billed, so the difference is a seller debt:
-- recovered from their payout by the existing SellerCharge ledger, and invoiced
-- to them with the declared-vs-billed reason.
--
-- SHIPPING_VARIANCE is that debt. The recovery machinery is kind-agnostic, so
-- an outstanding variance on one sale is set off against the seller's NEXT
-- payout, exactly as a failed-shipment charge already is.
--
-- ⚠️ ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- inserts the value, so this migration does nothing else.

ALTER TYPE "SellerChargeKind" ADD VALUE IF NOT EXISTS 'SHIPPING_VARIANCE';

-- Where the Books document for a charge lives. NULL for the failure kinds,
-- which are explained on the remittance advice instead; set for a variance so a
-- re-fired webhook cannot raise a second invoice.
ALTER TABLE "SellerCharge" ADD COLUMN "zohoInvoiceId" TEXT;
