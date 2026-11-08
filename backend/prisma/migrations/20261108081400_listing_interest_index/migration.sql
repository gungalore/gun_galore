-- Seller-facing listing interest.
--
-- The seller's "how much interest has this listing generated?" panel reads
-- UserEvent by listingId, and until now the table was indexed only on
-- createdAt, (userId, createdAt) and (eventType, createdAt). Every popover
-- open would therefore have seq-scanned the whole behavioural-event table.
--
-- The composite covers both reads the endpoint makes: the lifetime total
-- (listingId + eventType) and the last-7-days variant (both + createdAt
-- range). CREATE INDEX (not CONCURRENTLY) because Prisma runs migrations in a
-- transaction; the table holds ~13k rows, so the write lock is momentary.

CREATE INDEX "UserEvent_listingId_eventType_createdAt_idx"
  ON "UserEvent"("listingId", "eventType", "createdAt");
