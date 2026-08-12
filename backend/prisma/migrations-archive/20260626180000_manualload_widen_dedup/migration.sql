-- Widen the ManualLoad dedup key so different bullets of the same weight (same
-- manual/page/powder/start charge but different bullet name or max charge) are
-- kept as separate loads instead of being collapsed by the narrower key.

DROP INDEX "ManualLoad_dedup_key";

CREATE UNIQUE INDEX "ManualLoad_dedup_key"
    ON "ManualLoad"(
        "manualLabel", "pageNumber", "powderName", "bulletMaker",
        "bulletName", "bulletWeightGr", "startGr", "maxGr"
    );
