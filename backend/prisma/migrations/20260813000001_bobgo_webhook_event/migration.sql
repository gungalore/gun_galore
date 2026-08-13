-- M35 — keep Bob Go webhook payloads verbatim.
--
-- Bob Go's status vocabulary is only partly known. We have observed exactly
-- four strings (pending-rates, success, no-rates, pending-collection) and the
-- API documents none of the rest. Meanwhile status-map.ts collapses carrier
-- statuses by SUBSTRING, which is how an unseen "ready_for_pickup" gets read as
-- "out for delivery" (telling a buyer their parcel is coming while it sits in a
-- locker) and "expired" gets read as a terminal delivery failure.
--
-- The safe way out is evidence, not guesswork: the webhook receiver applies
-- only statuses it recognises, and stores EVERY payload here whole so the map
-- can be widened from strings Bob Go actually sent.
--
-- payload is jsonb and unparsed on purpose — the value of this table is the
-- fields we did not know to ask for.
--
-- Safe against production: a brand-new table touches nothing existing.

CREATE TABLE IF NOT EXISTS "BobGoWebhookEvent" (
  "id"         TEXT NOT NULL,
  "topic"      TEXT NOT NULL,
  "shipmentId" TEXT,
  "payload"    JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BobGoWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BobGoWebhookEvent_shipmentId_idx"
  ON "BobGoWebhookEvent" ("shipmentId");
CREATE INDEX IF NOT EXISTS "BobGoWebhookEvent_topic_createdAt_idx"
  ON "BobGoWebhookEvent" ("topic", "createdAt");
