// Estimated-delivery helper (Phase 5 P5.1). Pure functions, no deps, so
// the logic is unit-testable without the Nest container.
//
// We don't have a live transit-time API for both couriers (PUDO's rate
// response carries none; TCG's is buried in a service-level description),
// so we use a conservative per-method business-day window. The result is
// always framed to the user as "estimated / expected by" — NEVER a
// guarantee, because dispatch timing is at the seller's discretion.

export type EstimableMethod = 'PUDO' | 'TCG';

// Upper-bound business days from dispatch to delivery, per courier.
// Deliberately conservative so we under-promise.
const TRANSIT_BUSINESS_DAYS: Record<EstimableMethod, number> = {
  PUDO: 5, // locker-to-locker
  TCG: 4, // door-to-door
};

// Methods with no carrier transit the platform can estimate.
//  - PRIVATE_ARRANGE: buyer & seller coordinate the handover themselves.
//  - DEALER_TRANSFER: gated on dealer verification, no platform ETA.
export function methodHasEstimate(method: string | null | undefined): method is EstimableMethod {
  return method === 'PUDO' || method === 'TCG';
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

// The estimated delivery date for a dispatched courier order, or null when
// the method has no platform-estimable transit.
export function estimateDeliveryDate(
  method: string | null | undefined,
  dispatchedAt: Date,
): Date | null {
  if (!methodHasEstimate(method)) return null;
  return addBusinessDays(dispatchedAt, TRANSIT_BUSINESS_DAYS[method]);
}
