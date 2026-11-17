-- The interview brief.
--
-- Four nullable columns on Motivation, following the suitability precedent:
-- the encrypted JSON, the wording version, the hash of the facts it was built
-- from, and when. The interview reads this on every card; MotivationIntakeBriefService
-- writes it once per fact-hash, in the background, so no request waits on
-- research.
--
-- Additive and nullable, so an existing row reads as "no brief" and the
-- deterministic planner serves its labels exactly as before.

ALTER TABLE "Motivation"
  ADD COLUMN "intakeBriefEncrypted" TEXT,
  ADD COLUMN "intakeBriefVersion" VARCHAR(40),
  ADD COLUMN "intakeBriefHash" VARCHAR(64),
  ADD COLUMN "intakeBriefAt" TIMESTAMP(3);
