-- Dealer stock-in: the stamp's CIPC number, and the SAPS 350(a).
--
-- `Dealer.regNumber` stores the company registration number read off the
-- dealer stamp; the CIPC lookup is what turns it into a verdict.
-- `DealerPortalRequest.saps350PhotoUrl` stores the "Dealer's Return: Stock
-- Received" the dealer submits, which a firearm may not be marked stocked
-- without.
ALTER TABLE "Dealer" ADD COLUMN "regNumber" TEXT;

ALTER TABLE "DealerPortalRequest" ADD COLUMN "saps350PhotoUrl" TEXT;
