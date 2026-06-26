-- Make ManualLoad self-contained for a locally-built seed: store the manual
-- display label directly + make the manual FK optional. Table is empty (no
-- extraction has run), so this is non-destructive.

ALTER TABLE "ManualLoad" DROP CONSTRAINT "ManualLoad_manualId_fkey";
DROP INDEX "ManualLoad_manualId_pageNumber_powderName_bulletWeightGr_sta_key";

ALTER TABLE "ManualLoad" ALTER COLUMN "manualId" DROP NOT NULL;
ALTER TABLE "ManualLoad" ADD COLUMN "manualLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ManualLoad" ALTER COLUMN "manualLabel" DROP DEFAULT;

ALTER TABLE "ManualLoad"
    ADD CONSTRAINT "ManualLoad_manualId_fkey"
    FOREIGN KEY ("manualId") REFERENCES "ReloadingManual"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ManualLoad_dedup_key"
    ON "ManualLoad"("manualLabel", "pageNumber", "powderName", "bulletWeightGr", "startGr");
