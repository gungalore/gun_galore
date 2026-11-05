-- Store the hosted checkout URL so an interrupted payment can resume the
-- SAME provider session instead of minting a second payable link.
ALTER TABLE "Transaction" ADD COLUMN "gatewayRedirectUrl" TEXT;
