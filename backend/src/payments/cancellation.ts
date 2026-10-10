// ─── Buyer-cancellation refund maths (Phase 4 rework, pure) ────────────
//
// A buyer can no longer self-refund a paid order. They REQUEST a
// cancellation; support resolves it with a fee-retained refund:
//
//   • The Buyer Protection Fee (the stored `processingFee` — Ozow's card
//     cost) is ALWAYS retained. Ozow does not return its processing fee on a
//     refund, so it is money AllOutdoor has already spent to take and reverse
//     the payment. Operator decision 2026-10-10.
//   • The carrier cost (`shippingCost`) is retained ONLY when the parcel is
//     committed (a waybill was booked). Bob Go exposes no cancel API, so a
//     booked waybill cannot be reliably voided — the charge stands.
//   • The shipping-handling margin and the marketplace markup are NEVER
//     retained: they are platform profit, not a cost, and keeping them on a
//     buyer's change of mind reads as a penalty rather than cost recovery.
//
// A seller-fault reversal (reject, no-dispatch SLA, undelivered) does NOT use
// this — those refund the full `buyerTotal` including the fee.

export interface CancellationRefundInput {
  /** What the buyer paid in total. */
  buyerTotal: number;
  /** The stored Buyer Protection Fee / gateway cost (always retained). */
  processingFee: number;
  /** The pure carrier remittance (retained only when committed). */
  shippingCost: number;
  /** True when a waybill was booked and cannot be reliably voided. */
  shipmentCommitted: boolean;
}

export interface CancellationRefund {
  /** Amount returned to the buyer's original payment method. */
  refundableCents: number;
  /** Amount the platform retains (cost recovery). */
  retainedCents: number;
  /** Breakdown for the admin confirm screen + the buyer notice. */
  retained: {
    buyerProtectionFeeCents: number;
    shippingCents: number;
  };
}

/**
 * Compute what a buyer-choice cancellation refunds vs retains. Pure; clamps so
 * a corrupt row can never produce a negative refund or over-retain.
 */
export function cancellationRefundableCents(
  input: CancellationRefundInput,
): CancellationRefund {
  const buyerTotal = Math.max(0, Math.round(input.buyerTotal));
  const fee = Math.max(0, Math.round(input.processingFee));
  const shipping = input.shipmentCommitted
    ? Math.max(0, Math.round(input.shippingCost))
    : 0;
  const retainedCents = Math.min(buyerTotal, fee + shipping);
  const refundableCents = Math.max(0, buyerTotal - retainedCents);
  return {
    refundableCents,
    retainedCents,
    retained: {
      buyerProtectionFeeCents: Math.min(fee, retainedCents),
      // The shipping slice of what we kept, capped by what's left after the fee.
      shippingCents: Math.max(0, retainedCents - Math.min(fee, retainedCents)),
    },
  };
}

/** A waybill that exists is treated as committed (Bob Go has no cancel API). */
export function isShipmentCommitted(tx: {
  carrierShipmentId?: string | null;
}): boolean {
  return !!tx.carrierShipmentId;
}
