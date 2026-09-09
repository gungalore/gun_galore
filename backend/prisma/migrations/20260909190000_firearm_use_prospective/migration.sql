-- THE SAME USES, RESTATED FOR A FIREARM NOBODY OWNS YET.
--
-- Operator, 2026-09-09: "send it a fourth querry to state that the whole answer
-- should be phrased as 'would like to' or 'I have taken an interest in' or
-- something like that. that would help set up as motivation because if I state
-- that I already, the obvious question will be why do you need a firearm for it
-- if you already do."
--
-- ⚠️ THE TENSE IS AN ARGUMENT, NOT A STYLE. "I use it for plains game" is true
-- of a rifle in the safe and false of one on an application form — and a DFO
-- reading it about the firearm applied for asks the obvious question. Both
-- voices are held on one row: `uses` for a firearm already licensed, where the
-- present tense is the truth, and `usesProspective` for the one being applied
-- for.
--
-- Purely additive: one column, defaulted empty, nothing backfilled and nothing
-- rewritten. The table holds no rows in production yet.
ALTER TABLE "FirearmUseProfile"
  ADD COLUMN "usesProspective" TEXT[] DEFAULT ARRAY[]::TEXT[];
