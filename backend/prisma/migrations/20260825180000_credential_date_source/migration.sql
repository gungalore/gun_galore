-- Who put the date there.
--
-- The Document Centre is to fill dates in rather than ask the member to
-- confirm each one. Operator, 2026-08-25: "insert it. No further user
-- interaction required. Thats why we are designing this system, for
-- automation and ease of use!"
--
-- confirmedAt keeps its one narrow meaning -- a member looked -- and this
-- column carries the other half: we filled it in, nobody has checked it.
-- Without it, a recomputation cannot tell its own arithmetic from an answer
-- the member typed, so "recompute when a licence changes" would degrade to
-- "recompute never" and a stored competency date would be wrong from the
-- member's next renewal onwards.
--
-- NOTHING IS BACKFILLED. Every existing row keeps asking, deliberately: the
-- reminder ladder's final stage fires on anything already past its expiry, so
-- arming the existing pile would send a burst of notices about licences that
-- lapsed years ago. New uploads only.

ALTER TABLE "Credential"
  ADD COLUMN "dateSource"        VARCHAR(16),
  ADD COLUMN "dateSourceNote"    TEXT,
  ADD COLUMN "dateReadConfident" BOOLEAN NOT NULL DEFAULT false;

-- The reminder sweep's second predicate, mirroring the confirmedAt one.
CREATE INDEX "Credential_dateSource_remindersMuted_expiresOn_idx"
  ON "Credential" ("dateSource", "remindersMuted", "expiresOn");
