// Single source of truth for carrier tracking-status → internal status.
//
// Bob Go is the ONLY courier rail (Pudo and The Courier Guy were retired
// 2026-09-24). Bob Go's exact-key table lives below; anything absent returns
// null — recorded on the timeline, never rolling shippingStatus. Widen it only
// from statuses actually observed arriving.
//
// normalise() uppercases and turns whitespace/hyphens into underscores BEFORE
// lookup, so callers pass the raw carrier status exactly as sent (in-transit,
// "In Transit", IN_TRANSIT all resolve to the same key).
//
// SAFETY: only the unambiguous "buyer has it" status reaches DELIVERED, so
// nothing in-transit or failed can trip the payout gate.

export type PrismaShippingStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED';

function normalise(raw: string): string {
  return (raw ?? '').toString().trim().toUpperCase().replace(/[\s\-]+/g, '_');
}

// ─── Bob Go ───────────────────────────────────────────────────────────────
//
// An exact-key table: anything absent returns null. Sources are tracked because
// they are not equally strong:
//   OBSERVED  arrived in a real `status` field on a real webhook/API response.
//   CANONICAL a key of Bob Go's own `tracking_steps`, which enumerates the
//             lifecycle it models (created 1, collected 2, in-transit 3,
//             out-for-delivery 4, delivered 5).
const BOBGO_STATUS_MAP: Record<string, PrismaShippingStatus> = {
  PENDING_COLLECTION: 'PENDING', // OBSERVED 2026-08-13
  CREATED: 'PENDING', // CANONICAL step 1
  COLLECTED: 'COLLECTED', // CANONICAL step 2
  IN_TRANSIT: 'IN_TRANSIT', // CANONICAL step 3
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', // CANONICAL step 4
  DELIVERED: 'DELIVERED', // CANONICAL step 5

  // ── STORE_PICKUP (Pargo counter) ──────────────────────────────────
  // ⚠️ VOCABULARY UNVERIFIED. The sandbox returns no pickup-point shipments,
  // so none of these have been seen on a real webhook yet. They are mapped
  // from the plausible Bob Go words; the raw event is stored either way, and
  // an unknown status is still refused (never guessed) — see the caller.
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  READY_FOR_COLLECTION: 'READY_FOR_PICKUP',
  AWAITING_COLLECTION: 'READY_FOR_PICKUP',
  AT_PICKUP_POINT: 'READY_FOR_PICKUP',
  // The buyer collected it → functionally delivered.
  COLLECTED_BY_CUSTOMER: 'DELIVERED',
  PICKED_UP: 'DELIVERED',
};

/**
 * Bob Go tracking status → Prisma ShippingStatus, or null when we do not know.
 *
 * Null is a real answer and the caller must respect it: record the event, leave
 * shippingStatus alone, and let a human widen the table from the payload we
 * kept. Guessing here is how a buyer gets told their parcel is out for delivery
 * while it sits in a depot, or that delivery failed when nothing failed.
 */
export function bobgoToShippingStatus(
  raw: string,
): PrismaShippingStatus | null {
  return BOBGO_STATUS_MAP[normalise(raw)] ?? null;
}

/** True when Bob Go's status is one we can act on. */
export function isKnownBobGoStatus(raw: string): boolean {
  return normalise(raw) in BOBGO_STATUS_MAP;
}

// ─── Collapsed internal status → Prisma ShippingStatus ────────────────────────
// Only statuses that should roll Transaction.shippingStatus appear here.
// Unknown/internal milestones (PAYMENT_RECEIVED, SELLER_DISPATCHED, …) return
// null so shippingStatus is untouched.
const COLLAPSED_TO_PRISMA: Record<string, PrismaShippingStatus> = {
  COLLECTED: 'COLLECTED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURNED: 'RETURNED',
};

/**
 * Roll a collapsed internal status down to the coarse Prisma ShippingStatus.
 * Returns null when there's no mapping — caller leaves shippingStatus alone.
 */
export function toShippingStatus(
  collapsed: string,
): PrismaShippingStatus | null {
  return COLLAPSED_TO_PRISMA[collapsed] ?? null;
}

// Human-friendly default messages for the timeline UI when the carrier
// doesn't send an explicit description. Keyed by collapsed status.
export const STATUS_LABEL: Record<string, string> = {
  // Internal milestones
  PAYMENT_RECEIVED: 'Payment received — funds held by All Outdoor',
  AWAITING_SELLER_DISPATCH: 'Awaiting seller dispatch',
  SELLER_DISPATCHED: 'Seller marked the parcel as dispatched',
  // Firearm DEALER_TRANSFER. There is no parcel and no courier — the seller
  // physically hands the firearm to their SAPS-licensed dealer. Kept distinct
  // from SELLER_DISPATCHED so the buyer's timeline never claims a courier is
  // carrying a firearm.
  DEALER_HANDOVER_STARTED: 'Seller transferred the firearm to the dealer',
  BUYER_CONFIRMED_DELIVERY: 'Buyer confirmed delivery',
  PAYOUT_RELEASED: 'Funds released to seller',
  // Movement
  COLLECTED: 'Collected by the courier',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  READY_FOR_PICKUP: 'Ready for collection at the pickup point',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  RETURNED: 'Return to sender initiated',
};
