-- WHAT A FIREARM OF THIS CLASS IS PLAUSIBLY USED FOR, IN SOUTH AFRICA.
--
-- Operator, 2026-09-09: "we keep a small database with the calibre, Type (as
-- its shown on the license) and section. then we build a general database for
-- all calibers which we can grab from… it has to generate for all sections it
-- can fall into respectively. and for section 15 it has to have for the
-- occational hunter/sport shooter and for section 16 for the dedicated
-- hunter/sportshooter."
--
-- ⚠️ ONE ROW PER CLASS AND SLICE, where a slice is a section and — for 15 and
-- 16 — a discipline. A .30-06 bolt rifle holds four rows; a manual shotgun
-- holds five. One generation writes every slice a class can lawfully fall
-- into, and the member's own licence card chooses which one the writer sees.
--
-- ⚠️ KEYED ON THE CLASS, NOT ON THE MEMBER OR THE FIREARM. A .30-06 has the
-- same plausible uses whoever owns it, so one set of rows serves every
-- applicant who ever holds one. The second applicant with a .30-06 costs
-- nothing, whatever section they hold it under.
--
-- ⚠️ NO PERSONAL DATA, WHICH IS WHY IT CAN BE SHARED AND WHY NOTHING HERE IS
-- ENCRYPTED. The key is a cartridge, a type, an action and a section — facts
-- about a CATEGORY of firearm. Nothing in this table is anybody's.
--
-- Purely additive: a new table, no column touched, nothing backfilled.
CREATE TABLE "FirearmUseProfile" (
  "id"        TEXT NOT NULL,
  "classKey"  TEXT NOT NULL,
  "calibre"   TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "slice"     TEXT NOT NULL,
  "uses"      TEXT[],
  "model"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FirearmUseProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirearmUseProfile_classKey_key" ON "FirearmUseProfile"("classKey");
CREATE INDEX "FirearmUseProfile_calibre_idx" ON "FirearmUseProfile"("calibre");
CREATE INDEX "FirearmUseProfile_slice_idx" ON "FirearmUseProfile"("slice");
