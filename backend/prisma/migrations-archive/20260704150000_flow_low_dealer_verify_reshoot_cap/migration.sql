-- LOW (dealer-verify reshoot cap): additive attempt counter on Transaction.
-- Incremented on every dealer-verification upload; once it reaches the cap the
-- upload is blocked, the tx is routed to PENDING_ADMIN_REVIEW, and an admin
-- alert is raised — so a persistently-failing (or hostile) seller can't loop
-- upload->REJECTED forever (each cycle burns a Claude vision call + 3 uploads).
-- Default 0 backfills existing rows.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "dealerVerifyAttempts" INTEGER NOT NULL DEFAULT 0;
