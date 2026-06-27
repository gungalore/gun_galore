-- Published case-fill / load-density % per load (Somchem prints Case Fill %,
-- Nosler prints Load Density (Volume) %). Null where the manual doesn't print
-- it; the Recommended Loads panel estimates fill for those from GRT data.

ALTER TABLE "ManualLoad" ADD COLUMN "fillPctStart" DOUBLE PRECISION;
ALTER TABLE "ManualLoad" ADD COLUMN "fillPctMax" DOUBLE PRECISION;
