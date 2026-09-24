// Estimated-delivery helper (Phase 5 P5.1). Pure functions, no deps, so
// the logic is unit-testable without the Nest container.
//
// We don't have a live transit-time API, so we use a conservative
// business-day window counted from PAYMENT. The result is always framed to
// the user as "estimated / expected by" — NEVER a guarantee, because the
// pickup date is chosen by the seller and dispatch timing is theirs to move.

export type EstimableMethod = 'COURIER';

// Upper-bound business days for delivery, measured FROM PAYMENT.
//
// ⚠️ THE ANCHOR IS PAYMENT, NOT DISPATCH. The seller now chooses the pickup
// date, so dispatch timing is theirs to move; counting from payment is the
// only figure we can honestly stand behind. The number is deliberately
// conservative (10 business days) to cover the seller's chosen pickup slot
// plus the courier's worst published transit, and it is always framed as an
// estimate, never a guarantee.
const TRANSIT_BUSINESS_DAYS: Record<EstimableMethod, number> = {
  COURIER: 10,
};

// Methods with no carrier transit the platform can estimate.
//  - PRIVATE_ARRANGE: buyer & seller coordinate the handover themselves.
//  - DEALER_TRANSFER: gated on dealer verification, no platform ETA.
export function methodHasEstimate(method: string | null | undefined): method is EstimableMethod {
  return method === 'COURIER';
}

// Add N business days (Mon–Fri) to a date, returning a new Date. Does not
// account for public holidays — it's an estimate, not a guarantee.
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// The estimated delivery date for a couriered order, or null when the method
// has no platform-estimable transit. `anchor` is the date the clock starts
// from — PAID (the order's paidAt), never dispatch.
export function estimateDeliveryDate(
  method: string | null | undefined,
  anchor: Date,
): Date | null {
  if (!methodHasEstimate(method)) return null;
  return addBusinessDays(anchor, TRANSIT_BUSINESS_DAYS[method]);
}
