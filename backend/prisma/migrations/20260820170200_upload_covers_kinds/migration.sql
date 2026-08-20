-- One attachment can satisfy several checklist rows.
--
-- An association membership certificate is routinely both the association card
-- and the section 16 letter of good standing. A second upload row for the same
-- bytes would collide with the (motivationId, sha256) unique index, and the
-- annexure builder iterates upload ROWS — so the same page would print twice
-- in the pack under two letters. The extra roles ride on the one row instead.
--
-- Empty default: every existing row keeps exactly the behaviour it has.
ALTER TABLE "MotivationUpload"
  ADD COLUMN IF NOT EXISTS "coversKinds" "MotivationUploadKind"[] NOT NULL DEFAULT ARRAY[]::"MotivationUploadKind"[];
