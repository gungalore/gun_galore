-- Additive: flag manuals whose page text came from the Anthropic OCR
-- backfill (src/reloading/scripts/ocr-backfill.ts) rather than pdf-parse.
ALTER TABLE "ReloadingManual" ADD COLUMN "ocr" BOOLEAN NOT NULL DEFAULT false;
