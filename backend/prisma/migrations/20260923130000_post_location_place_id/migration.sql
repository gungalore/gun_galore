-- Tag a post's place to the exact Google Places result, not a text search.
ALTER TABLE "Post" ADD COLUMN "locationPlaceId" TEXT;
