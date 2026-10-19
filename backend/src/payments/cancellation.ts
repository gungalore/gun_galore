// ─── Buyer-cancellation refund maths (Phase 4 rework, pure) ────────────
//
// A buyer can no longer self-refund a paid order. They REQUEST a
// cancellation; support resolves it with a fee-retained refund:
//
//   • A flat 4% transaction handling fee is ALWAYS retained. It recovers the
//     non-recoverable payment-gateway, interchange and reversal costs already
//     incurred in taking and reversing the payment. Operator decision
//     2026-10. It is a reasonable cancellation charge under CPA s17(3).
//   • The carrier cost and our delivery margin (`shippingCost` +
//     `shippingHandlingCents`) are retained ONLY when the parcel is committed:
//     the seller has accepted AND a waybill was booked. Bob Go exposes no
//     cancel API, so a booked waybill cannot be reliably voided — the charge
//     stands.
//   • The Platform Fee is REFUNDED: the platform does not keep its own fee on
//     a buyer's change of mind.
//   • Once the item has been DISPATCHED the buyer cannot cancel at all; the
//     dispute route applies instead. This helper is only reached before
//     dispatch.
//
// A seller-fault reversal (reject, no-dispatch SLA, undelivered) does NOT use
// this — those refund the full `buyerTotal`.

/** The 4% transaction handling fee retained on a buyer-choice cancellation. */
export const CANCELLATION_HANDLING_RATE = 0.04;

export interface CancellationRefundInput {
  /** What the buyer paid in total. */
  buyerTotal: number;
  /** The BUYER-paid Platform Fee — refunded in full on a cancellation. */
  processingFee: number;
  /** The pure carrier remittance (retained only when committed). */
  shippingCost: number;
  /** Our delivery margin, shown inside the delivery figure (retained only when committed). */
  shippingHandlingCents?: number;
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
    handlingFeeCents: number;
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
  const platformFee = Math.max(0, Math.round(input.processingFee));
  const shipping = input.shipmentCommitted
    ? Math.max(
        0,
        Math.round(input.shippingCost) +
          Math.round(input.shippingHandlingCents ?? 0),
      )
    : 0;

  // The 4% is charged on what the buyer paid for the goods and delivery —
  // not on our own Platform Fee, which is refunded in full.
  const goodsAndDelivery = Math.max(0, buyerTotal - platformFee);
  const handlingFee = Math.round(
    goodsAndDelivery * CANCELLATION_HANDLING_RATE,
  );

  const retainedCents = Math.min(buyerTotal, handlingFee + shipping);
  const refundableCents = Math.max(0, buyerTotal - retainedCents);
  return {
    refundableCents,
    retainedCents,
    retained: {
      handlingFeeCents: Math.min(handlingFee, retainedCents),
      // The shipping slice of what we kept, capped by what's left.
      shippingCents: Math.max(0, retainedCents - Math.min(handlingFee, retainedCents)),
    },
  };
}

/** A waybill that exists is treated as committed (Bob Go has no cancel API). */
export function isShipmentCommitted(tx: {
  carrierShipmentId?: string | null;
}): boolean {
  return !!tx.carrierShipmentId;
}
