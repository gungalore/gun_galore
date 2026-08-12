-- FLOW-F7 (raffle-ticket-races): reject duplicate ticket numbers within a
-- raffle at the DB level so a concurrent buy can no longer silently create
-- two tickets with the same number.
--
-- IF NOT EXISTS per the additive-migration rule. This presumes no existing
-- duplicate (raffleId, ticketNumber) rows — safe here because paid entry has
-- never actually worked in production (no manual-EFT purchase lane exists, so
-- no concurrent paid buys have ever run), so the table holds no duplicates to
-- trip the unique build.
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_raffleId_ticketNumber_key"
  ON "Ticket"("raffleId", "ticketNumber");
