// Why a courier shipment failed, and who pays for the wasted booking.
//
// Mirrors the shape of seller-reject-policy.ts: a fixed ticklist of reasons,
// each carrying an explicit consequence, so the decision lives in one table
// rather than being re-argued at every call site. FRONTEND LISTS MUST MIRROR
// THESE VALUES — the same gotcha the offer-reject ticklist has.
//
// The money rule (operator, 2026-08-13): when a shipment fails because the
// SELLER got it wrong — most often measuring a parcel that then does not fit
// the collection point — the wasted courier charge is theirs. They rebook, and
// the amount is deducted from what they are paid for the sale.
//
// The charge is NOT applied by mutating sellerPayout. That column is a
// point-of-sale snapshot and must stay one; the charge accumulates in
// Transaction.failedShipmentChargeCents and is subtracted where payouts are
// computed. So the sale record still shows what was agreed, and the deduction
// is visible as a separate, explainable line.

export const SHIPMENT_FAILURE_REASONS = [
  // ── seller's error: they pay ──
  'PARCEL_TOO_LARGE',
  'PARCEL_OVERWEIGHT',
  'SELLER_UNAVAILABLE',
  'COLLECTION_ADDRESS_WRONG',
  'PARCEL_NOT_READY',
  // ── not the seller's fault: no charge ──
  'BUYER_UNREACHABLE',
  'DELIVERY_ADDRESS_WRONG',
  'COLLECTION_POINT_FULL',
  'CARRIER_ERROR',
  'PARCEL_LOST_OR_DAMAGED',
  // ── needs a human to decide ──
  'OTHER',
] as const;

export type ShipmentFailureReason = (typeof SHIPMENT_FAILURE_REASONS)[number];

export const SHIPMENT_FAILURE_LABEL: Record<ShipmentFailureReason, string> = {
  PARCEL_TOO_LARGE: "Parcel didn't fit — larger than the measurements given",
  PARCEL_OVERWEIGHT: 'Parcel was heavier than the weight given',
  SELLER_UNAVAILABLE: 'Nobody available at collection',
  COLLECTION_ADDRESS_WRONG: 'Collection address was wrong or incomplete',
  PARCEL_NOT_READY: 'Parcel was not packed and ready',
  BUYER_UNREACHABLE: 'Buyer could not be reached',
  DELIVERY_ADDRESS_WRONG: 'Delivery address was wrong or incomplete',
  COLLECTION_POINT_FULL: 'Collection point had no space',
  CARRIER_ERROR: 'Courier error',
  PARCEL_LOST_OR_DAMAGED: 'Parcel lost or damaged in transit',
  OTHER: 'Other',
};

/**
 * Reasons the SELLER is charged for.
 *
 * Every one of these is something the seller controls and could have got
 * right. Deliberately does NOT include COLLECTION_POINT_FULL — a full locker
 * is the network's problem, not the seller's, even though it looks similar to
 * a parcel that does not fit. Nor CARRIER_ERROR, for obvious reasons.
 *
 * OTHER is excluded on purpose: it is the reason chosen when nobody is sure,
 * and charging money on an unexplained failure is exactly the kind of decision
 * that should require a human to first say what happened.
 */
const SELLER_PAYS: ReadonlySet<ShipmentFailureReason> = new Set([
  'PARCEL_TOO_LARGE',
  'PARCEL_OVERWEIGHT',
  'SELLER_UNAVAILABLE',
  'COLLECTION_ADDRESS_WRONG',
  'PARCEL_NOT_READY',
]);

export function sellerPaysFor(reason: ShipmentFailureReason): boolean {
  return SELLER_PAYS.has(reason);
}

/**
 * Failures the seller must FIX before they can rebook.
 *
 * A parcel that did not fit will not fit the second time either. Letting the
 * seller rebook without correcting the measurements just burns another courier
 * charge — theirs, under the rule above — and delays the buyer again. So these
 * reasons demand updated dimensions before a rebook is accepted.
 */
const REQUIRES_REMEASURE: ReadonlySet<ShipmentFailureReason> = new Set([
  'PARCEL_TOO_LARGE',
  'PARCEL_OVERWEIGHT',
]);

export function requiresRemeasure(reason: ShipmentFailureReason): boolean {
  return REQUIRES_REMEASURE.has(reason);
}

export function isShipmentFailureReason(
  value: unknown,
): value is ShipmentFailureReason {
  return (
    typeof value === 'string' &&
    (SHIPMENT_FAILURE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * What to charge the seller for one failed booking.
 *
 * The courier was paid for a collection that produced nothing, and the rebook
 * pays them again — so the wasted amount is one shipping charge.
 *
 * `shippingCost` is the carrier rate the buyer was quoted. GG's own handling
 * margin (`shippingHandlingCents`) is deliberately NOT included: that is our
 * fee, we did not lose it to the carrier, and billing a seller for our margin
 * on top of the real cost would be charging twice for one mistake.
 */
export function failedShipmentChargeCents(tx: {
  shippingCost: number | null;
}): number {
  return Math.max(0, tx.shippingCost ?? 0);
}
