-- Transaction.feeModel — which direction our fees ran on this sale.
--
-- Both models write the SAME columns, so until now nothing downstream could
-- tell them apart. That is why the buyer's confirmation email, the receipt
-- PDF, the transaction page, the seller's statement and the Zoho reference
-- line each described the same sale differently — and why the receipt's own
-- line items did not sum to the total it printed.

-- CreateEnum
CREATE TYPE "FeeModel" AS ENUM ('BUYNOW_MARKUP', 'SELLER_DEDUCT');

-- AlterTable
ALTER TABLE "Transaction"
  ADD COLUMN "feeModel" "FeeModel" NOT NULL DEFAULT 'SELLER_DEDUCT';

-- NO BACKFILL, DELIBERATELY.
--
-- The obvious backfill is arithmetic — a marked-up row satisfies
--   listingPrice = sellerPayout + commissionZar + processingFee
-- but so does a SELLER_DEDUCT row where the SELLER absorbed the processing
-- fee (passFeeToBuyer = false), because that is the same equation. The two
-- are genuinely indistinguishable from the stored columns alone, so guessing
-- would mislabel real money rather than leave it plainly old.
--
-- SELLER_DEDUCT is the correct reading for every pre-existing row anyway: the
-- markup model shipped 2026-08-15, and this platform has not yet traded
-- (PAYMENTS_LIVE is unset; checkout returns 503). If rows are ever restored
-- from an instance that DID trade under the markup model, set them from the
-- listing's sellerAskCents rather than from this equation.
