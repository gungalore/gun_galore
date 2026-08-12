-- M26 (FLOW-F4): admin payout-HOLD lever. Additive columns on Transaction.
-- A due row with payoutHeldAt set is excluded from getPayoutsDue/collectDue
-- and never enters an FNB bulk-payment batch until an admin releases the hold.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "payoutHeldAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "payoutHoldReason" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "payoutHeldById" TEXT;
