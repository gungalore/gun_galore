-- Zoho Books posting corrections:
--   zohoShippingJournalId         — carrier freight now leaves Client Funds
--                                   Payable by journal (Dr trust / Cr bank),
--                                   because an Expense credits its paid-through
--                                   account and so increased the liability.
--   zohoCommissionSettleJournalId — drains the auction seller's commission from
--                                   the held-funds liability, paired with the
--                                   customer payment that clears the seller's
--                                   A/R (Books refuses a liability as a payment
--                                   deposit account).
ALTER TABLE "Transaction" ADD COLUMN "zohoShippingJournalId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "zohoCommissionSettleJournalId" TEXT;
