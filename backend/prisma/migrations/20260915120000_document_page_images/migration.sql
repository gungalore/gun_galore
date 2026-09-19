-- A page of an uploaded PDF, rasterised once and reused.
--
-- So the annexure pipeline only speaks one document type. pdfkit draws a JPEG
-- or a PNG anywhere in the flow; it cannot place a PDF page except at a page
-- boundary, so PDF annexures used to be spliced in by pdf-lib afterwards --
-- every one of them at the same spot near the back, never in their letter's
-- position, and with the contents numbering to match. Rasterising the page
-- removes the second document type from the annexures entirely.
--
-- Keyed on the sha256 of the SOURCE bytes rather than on an upload row: the
-- same municipal bill attached to two applications, or a vault document
-- adopted twice, is one rasterisation rather than two.
--
-- The image bytes live in SecureFileStorageService (encrypted at rest), not in
-- this row. What is here is the key to them and the dimensions the annexure
-- planner needs. Purged with the source document, and swept on expiry.
CREATE TABLE "DocumentPageImage" (
  "id"              TEXT         NOT NULL,
  "fileSha256"      VARCHAR(64)  NOT NULL,
  "page"            INTEGER      NOT NULL,
  "rendererVersion" VARCHAR(40)  NOT NULL,
  "storageKey"      TEXT         NOT NULL,
  "mimeType"        VARCHAR(40)  NOT NULL,
  "width"           INTEGER      NOT NULL,
  "height"          INTEGER      NOT NULL,
  "byteSize"        INTEGER      NOT NULL,
  "renderedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentPageImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentPageImage_fileSha256_page_rendererVersion_key"
  ON "DocumentPageImage"("fileSha256", "page", "rendererVersion");

CREATE INDEX "DocumentPageImage_expiresAt_idx"
  ON "DocumentPageImage"("expiresAt");

CREATE INDEX "DocumentPageImage_fileSha256_idx"
  ON "DocumentPageImage"("fileSha256");
