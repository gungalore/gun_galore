-- 2026-11 courier delivery instructions.
--
-- Additive only. Free-text instructions the buyer types at courier checkout,
-- sanitised + capped at 120 characters in TransactionsService and forwarded to
-- Bob Go as `instructions_delivery` so it is printed on the delivery label.
-- NULL on every non-courier sale (dealer transfer / private arrangement /
-- collection have no carrier label).
ALTER TABLE "Transaction" ADD COLUMN "deliveryInstructions" VARCHAR(120);
