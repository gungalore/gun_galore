-- THE IDENTIFY PASS'S MEMORY, BETWEEN THE PICKER AND THE POLISH.
--
-- ⚠️ WHY A TABLE AND NOT AN IN-MEMORY MAP. The member picks a batch of files,
-- the server mints an id per file, sends them to the model and holds the
-- verdict against that id; the member then polishes and uploads each file,
-- and the store handler files it from THIS record. Identify and store may land
-- on different PM2 workers, and a restart in between must not lose a batch the
-- member is mid-way through.
--
-- ⚠️ WHY THE VERDICT LIVES HERE AND NOT IN THE REQUEST. The client only ever
-- carries the id back. If the store handler took `kind` or `container` from
-- the request body, a verdict the client could type is a verdict the client
-- could forge. The id the server issued to that owner is the only door.
--
-- ⚠️ ocrTextEncrypted IS POPIA DATA AND IS ENCRYPTED. It is the full text of
-- a licence or an identity document — a name, an identity number, every serial
-- on the page. The sweep clears it before deleting the row, exactly as the
-- evidence retention rule does.
--
-- ⚠️ sha256 IS OF THE UNPOLISHED BYTES. Identify reads what was picked; the
-- polished file stored later has a different hash and will not match. That is
-- correct — they are different images. The marriage is by id, never by hash.
--
-- ⚠️ A SHORT LIFE. A member who identifies ten files and uploads none must
-- leave nothing behind, so expiresAt is set at identify time and the retention
-- sweep deletes the row.
CREATE TABLE "DocumentIdentify" (
    "id"              TEXT         NOT NULL,
    "ownerId"         TEXT         NOT NULL,
    "sha256"          VARCHAR(64)  NOT NULL,
    "role"            VARCHAR(16)  NOT NULL,
    "kind"            TEXT,
    "alsoCovers"      TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "container"       TEXT,
    "confident"       BOOLEAN      NOT NULL DEFAULT false,
    "ocrTextEncrypted" TEXT,
    "ocrChars"        INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentIdentify_pkey" PRIMARY KEY ("id")
);

-- The sweep's predicate, and the owner check on every store.
CREATE INDEX "DocumentIdentify_expiresAt_idx" ON "DocumentIdentify" ("expiresAt");
CREATE INDEX "DocumentIdentify_ownerId_idx"   ON "DocumentIdentify" ("ownerId");
