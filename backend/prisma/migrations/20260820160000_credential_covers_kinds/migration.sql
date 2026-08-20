-- One document can fill several credential roles.
--
-- A SA Hunters membership certificate declares the member in good standing,
-- carries the dedicated sport-shooter number, and gives one validity window
-- covering both. `kind` remains the document's primary identity; this lists
-- what else it counts as.
--
-- Empty default, so every existing row keeps exactly the behaviour it has.
ALTER TABLE "Credential"
  ADD COLUMN IF NOT EXISTS "coversKinds" "CredentialKind"[] NOT NULL DEFAULT ARRAY[]::"CredentialKind"[];
