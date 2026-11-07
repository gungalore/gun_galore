-- Close the three settlement holes in the Books rail.
--
-- 1. SellerCharge.zohoInvoicePaidCents — a courier re-weigh invoice is settled
--    in the slices the payout ledger actually collects, which can span more
--    than one payout. Without it the invoice is raised and never paid.
--
-- 2. Transaction.zohoBuyerCreditNoteId / zohoBuyerCreditNoteCents — a refund
--    has to reverse the BUYER's invoice (item + delivery out of Client Funds
--    Payable, the platform fee out of revenue). Only the seller commission was
--    being credited, so a refunded sale stayed on the books as completed.
--    `Cents` is cumulative, so a partial refund credits only the new slice.
--
-- 3. Transaction.zohoShippingVarianceJournalId — the carrier's re-weigh
--    surcharge is a cost we paid. The freight journal is built from the quote
--    the buyer paid and cannot carry it; without this the surcharge appears
--    only as recovery income, and the Books freight expense never matches the
--    carrier statement.

ALTER TABLE "SellerCharge" ADD COLUMN "zohoInvoicePaidCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "zohoBuyerCreditNoteId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "zohoBuyerCreditNoteCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "zohoShippingVarianceJournalId" TEXT;
