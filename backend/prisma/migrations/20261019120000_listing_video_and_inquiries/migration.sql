-- Marketplace video: one optional clip per listing, alongside its photos.
-- Cloudinary stores it on the `video` resource type; the poster frame is a
-- derived delivery URL, not a second upload.
CREATE TABLE "ListingVideo" (
  "id"              TEXT         NOT NULL,
  "listingId"       TEXT         NOT NULL,
  "url"             TEXT         NOT NULL,
  "publicId"        TEXT         NOT NULL,
  "thumbnailUrl"    TEXT,
  "durationSeconds" DOUBLE PRECISION,
  "width"           INTEGER,
  "height"          INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ListingVideo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingVideo_listingId_key" ON "ListingVideo"("listingId");

ALTER TABLE "ListingVideo"
  ADD CONSTRAINT "ListingVideo_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Private 1-to-1 buyer↔seller "contact seller" threads. One per
-- (listingId, buyerId); the listing's seller is snapshotted on the row.
CREATE TABLE "ListingInquiry" (
  "id"            TEXT         NOT NULL,
  "listingId"     TEXT         NOT NULL,
  "buyerId"       TEXT         NOT NULL,
  "sellerId"      TEXT         NOT NULL,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ListingInquiry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingInquiry_listingId_buyerId_key"
  ON "ListingInquiry"("listingId", "buyerId");
CREATE INDEX "ListingInquiry_sellerId_lastMessageAt_idx"
  ON "ListingInquiry"("sellerId", "lastMessageAt" DESC);
CREATE INDEX "ListingInquiry_buyerId_lastMessageAt_idx"
  ON "ListingInquiry"("buyerId", "lastMessageAt" DESC);

ALTER TABLE "ListingInquiry"
  ADD CONSTRAINT "ListingInquiry_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingInquiry"
  ADD CONSTRAINT "ListingInquiry_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingInquiry"
  ADD CONSTRAINT "ListingInquiry_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "ListingInquiryMediaKind" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "ListingInquiryMessage" (
  "id"              TEXT         NOT NULL,
  "inquiryId"       TEXT         NOT NULL,
  "senderId"        TEXT         NOT NULL,
  "content"         TEXT         NOT NULL,
  "originalContent" TEXT,
  "wasModerated"    BOOLEAN      NOT NULL DEFAULT false,
  "readAt"          TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ListingInquiryMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingInquiryMessage_inquiryId_createdAt_idx"
  ON "ListingInquiryMessage"("inquiryId", "createdAt");

ALTER TABLE "ListingInquiryMessage"
  ADD CONSTRAINT "ListingInquiryMessage_inquiryId_fkey"
  FOREIGN KEY ("inquiryId") REFERENCES "ListingInquiry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingInquiryMessage"
  ADD CONSTRAINT "ListingInquiryMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ListingInquiryMedia" (
  "id"              TEXT                     NOT NULL,
  "messageId"       TEXT                     NOT NULL,
  "kind"            "ListingInquiryMediaKind" NOT NULL,
  "url"             TEXT                     NOT NULL,
  "publicId"        TEXT                     NOT NULL,
  "thumbnailUrl"    TEXT,
  "durationSeconds" DOUBLE PRECISION,
  "width"           INTEGER,
  "height"          INTEGER,
  "createdAt"       TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ListingInquiryMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingInquiryMedia_messageId_idx"
  ON "ListingInquiryMedia"("messageId");

ALTER TABLE "ListingInquiryMedia"
  ADD CONSTRAINT "ListingInquiryMedia_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ListingInquiryMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
