-- One-click Bob Go booking from the desk email.
--
-- The operator receives the PDF with a link carrying this token. Opening the
-- page books the collection without a sign-in; the token is unguessable, belongs
-- to one print order, and the booking itself is idempotent once BOOKED.
--
-- Nullable: historical orders (there are none yet) and an order whose PDF has
-- not been emailed never have one.

ALTER TABLE "MotivationPrintOrder"
  ADD COLUMN "bookingToken" TEXT;

CREATE UNIQUE INDEX "MotivationPrintOrder_bookingToken_key"
  ON "MotivationPrintOrder"("bookingToken");
