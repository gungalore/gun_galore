-- Phase 5 (additive): fulfilment fields on Transaction.
--  P5.1 estimatedDeliveryAt — best-effort delivery window, set at dispatch.
--  P5.3 podReference / podProofUrl — proof-of-delivery audit trail
--       (carrier delivery event + optional uploaded photo). Neither gates
--       payout; payout stays on the buyer's confirmDelivery attestation.
ALTER TABLE "Transaction"
  ADD COLUMN "estimatedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "podReference" TEXT,
  ADD COLUMN "podProofUrl" TEXT;
