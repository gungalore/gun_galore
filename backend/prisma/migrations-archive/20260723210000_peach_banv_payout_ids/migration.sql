-- Peach bank-account verification (BANV) + payout webhook matching ids.
-- Additive; nullable + unique (NULLs exempt in Postgres).

ALTER TABLE "User" ADD COLUMN "bankVerificationId" TEXT;
CREATE UNIQUE INDEX "User_bankVerificationId_key" ON "User"("bankVerificationId");

ALTER TABLE "Transaction" ADD COLUMN "peachPayoutId" TEXT;
CREATE UNIQUE INDEX "Transaction_peachPayoutId_key" ON "Transaction"("peachPayoutId");
