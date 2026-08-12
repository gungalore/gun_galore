-- Phase 6 P6.3 (additive): seller default parcel size. Pre-fills the sell
-- form's parcel dimensions; listings still store their own dims.
ALTER TABLE "User"
  ADD COLUMN "defaultWeightGrams" INTEGER,
  ADD COLUMN "defaultLengthCm" INTEGER,
  ADD COLUMN "defaultWidthCm" INTEGER,
  ADD COLUMN "defaultHeightCm" INTEGER;
