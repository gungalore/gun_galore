-- Zoho Books: the manual journal that moves the delivery handling margin out
-- of Client Funds Payable into delivery income, so the buyer's invoice can show
-- a single Delivery figure while the carrier's freight remains a liability
-- collected on its behalf.
ALTER TABLE "Transaction" ADD COLUMN "zohoHandlingJournalId" TEXT;
