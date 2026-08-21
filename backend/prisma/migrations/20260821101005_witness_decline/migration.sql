-- A witness may say no the moment they open the link.
--
-- Recorded rather than deleted: the applicant needs to learn they have been
-- turned down instead of watching an invitation that never moves. Nobody is
-- obliged to give a character statement, and declining is not a fault — the
-- column exists to stop somebody waiting, not to mark anybody.
ALTER TABLE "MotivationWitness" ADD COLUMN "declinedAt" TIMESTAMP(3);
