// Single source of truth for carrier tracking-status → internal status.
//
// The Courier Guy AND Pudo both run on the Shiplogic platform, so they share
// ONE tracking vocabulary of hyphenated slugs (verified against TCG's official
// "Shipment statuses" + webhook docs and Pudo's dev.api-pudo.co.za tracking
// docs). Two layers:
//
//   1. mapShiplogicStatus(raw) → COLLAPSED fine-grained internal status
//      (e.g. PARCEL_DROPPED_OFF, AT_LOCKER, COLLECTED_BY_BUYER). Stored
//      verbatim on TrackingEvent.status so the timeline UI has something
//      fine-grained to show, and drives the polling cron's terminal-state
//      short-circuit. mapPudoStatus / mapTcgStatus are kept as aliases.
//
//   2. toShippingStatus(collapsed) / shiplogicToShippingStatus(raw)
//      → the coarse Prisma ShippingStatus enum (PENDING | COLLECTED |
//      IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED | DELIVERY_FAILED |
//      RETURNED) that rolls Transaction.shippingStatus forward and drives
//      notifications + the buyer "delivered" payout gate. Anything unmapped
//      returns null → caller leaves shippingStatus alone.
//
// normalise() uppercases and turns whitespace/hyphens into underscores BEFORE
// lookup, so callers pass the raw carrier status exactly as sent (in-transit,
// "In Transit", IN_TRANSIT all resolve to the same key).
//
// SAFETY: the webhook path (ShippingService.processShiplogicWebhook) routes
// through shiplogicToShippingStatus() so it and the poll can never drift. Only
// the two unambiguous "buyer has it" slugs (delivered, collected-by-recipient)
// reach DELIVERED — nothing in-transit or failed can trip the payout gate.

export type PrismaShippingStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED';

function normalise(raw: string): string {
  return (raw ?? '').toString().trim().toUpperCase().replace(/[\s\-]+/g, '_');
}

// ─── Raw Shiplogic slug (normalised) → collapsed internal status ──────────────
// Slugs NOT listed collapse to their normalised form and carry no Prisma
// mapping below, so they're recorded on the timeline but never roll
// shippingStatus (collection-assigned, on-hold, floor-check, cancelled, …).
const SHIPLOGIC_STATUS_MAP: Record<string, string> = {
  // ── pre-movement / booked (no shipping roll) ──
  SUBMITTED: 'SUBMITTED',
  CREATED: 'SUBMITTED',
  LABEL_CREATED: 'BOOKED',
  DEPOSIT_PENDING: 'DEPOSIT_PENDING',
  AWAITING_DROPOFF: 'AWAITING_DROPOFF',
  PUDO_PIN_ISSUED: 'PUDO_PIN_ISSUED',
  COLLECTION_ASSIGNED: 'COLLECTION_ASSIGNED',
  COLLECTION_UNASSIGNED: 'COLLECTION_ASSIGNED',
  COLLECTION_REJECTED: 'COLLECTION_ASSIGNED',
  COLLECTION_EXCEPTION: 'COLLECTION_EXCEPTION',
  COLLECTION_FAILED_ATTEMPT: 'COLLECTION_EXCEPTION',
  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  DELIVERY_UNASSIGNED: 'DELIVERY_ASSIGNED',
  DELIVERY_REJECTED: 'DELIVERY_ASSIGNED',
  ON_HOLD: 'ON_HOLD',
  ON_HOLD_INTERNAL: 'ON_HOLD',
  FLOOR_CHECK: 'FLOOR_CHECK',
  CANCELLED: 'CANCELLED',

  // ── collected / entered the network ──
  COLLECTED: 'PARCEL_COLLECTED',
  DROPPED_OFF: 'PARCEL_DROPPED_OFF',

  // ── in transit between hubs / lockers (non-terminal) ──
  IN_TRANSIT: 'PARCEL_IN_TRANSIT',
  AT_HUB: 'AT_HUB',
  AT_DESTINATION_HUB: 'AT_DESTINATION_HUB',
  READY_FOR_DISPATCH: 'PARCEL_IN_TRANSIT',
  MANIFESTED: 'PARCEL_IN_TRANSIT',
  RETURNED_TO_HUB: 'PARCEL_IN_TRANSIT',
  // non-terminal exception — courier follows up; kept "in transit" from a
  // notification POV rather than falsely alarming the buyer with a failure.
  DELIVERY_EXCEPTION: 'DELIVERY_EXCEPTION',
  EXCEPTION: 'DELIVERY_EXCEPTION',

  // ── arrived, awaiting the recipient ──
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  READY_FOR_PICKUP: 'AT_LOCKER',
  READY_FOR_COLLECTION: 'AT_LOCKER',
  ARRIVED_AT_LOCKER: 'AT_LOCKER',
  AT_LOCKER: 'AT_LOCKER',

  // ── the buyer has it (ONLY these reach DELIVERED) ──
  DELIVERED: 'DELIVERED',
  COLLECTED_BY_RECIPIENT: 'COLLECTED_BY_BUYER',

  // ── terminal failures ──
  DELIVERY_FAILED_ATTEMPT: 'DELIVERY_FAILED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  FAILED: 'DELIVERY_FAILED',
  UNDELIVERABLE: 'UNDELIVERABLE',
  EXPIRED: 'PIN_EXPIRED', // Pudo collection-PIN window lapsed

  // ── return to sender ──
  RETURNED_TO_SENDER: 'RETURN_INITIATED',
  RETURNED: 'RETURN_INITIATED',
};

// ─── Collapsed internal status → Prisma ShippingStatus ────────────────────────
// Only carrier states that should roll Transaction.shippingStatus appear here.
// Collapsed states absent from this map (SUBMITTED, BOOKED, COLLECTION_ASSIGNED,
// ON_HOLD, CANCELLED, and every INTERNAL milestone like PAYMENT_RECEIVED /
// SELLER_DISPATCHED) intentionally return null so shippingStatus is untouched.
const COLLAPSED_TO_PRISMA: Record<string, PrismaShippingStatus> = {
  PARCEL_COLLECTED: 'COLLECTED',
  PARCEL_DROPPED_OFF: 'COLLECTED',
  PARCEL_IN_TRANSIT: 'IN_TRANSIT',
  AT_HUB: 'IN_TRANSIT',
  AT_DESTINATION_HUB: 'IN_TRANSIT',
  DELIVERY_EXCEPTION: 'IN_TRANSIT', // non-terminal — keep "in transit"
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  AT_LOCKER: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  COLLECTED_BY_BUYER: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  UNDELIVERABLE: 'DELIVERY_FAILED',
  PIN_EXPIRED: 'DELIVERY_FAILED',
  RETURN_INITIATED: 'RETURNED',
  // Legacy internal collapsed states kept so old TrackingEvent rows + any
  // remaining callers still resolve.
  AWAITING_TCG_COLLECTION: 'PENDING',
  TCG_IN_TRANSIT: 'IN_TRANSIT',
  FAILED_DELIVERY: 'DELIVERY_FAILED',
};

export function mapShiplogicStatus(raw: string): string {
  const key = normalise(raw);
  return SHIPLOGIC_STATUS_MAP[key] ?? key;
}

// Kept for API symmetry / callers — both couriers are Shiplogic, so both
// delegate to the one map.
export const mapPudoStatus = mapShiplogicStatus;
export const mapTcgStatus = mapShiplogicStatus;

/**
 * Roll a collapsed internal status down to the coarse Prisma ShippingStatus.
 * Returns null when there's no mapping — caller leaves shippingStatus alone.
 */
export function toShippingStatus(
  collapsed: string,
): PrismaShippingStatus | null {
  return COLLAPSED_TO_PRISMA[collapsed] ?? null;
}

/**
 * Raw carrier slug → Prisma ShippingStatus in one hop (raw → collapsed →
 * Prisma). Used by the webhook path so webhook + poll share ONE decision.
 */
export function shiplogicToShippingStatus(
  raw: string,
): PrismaShippingStatus | null {
  return toShippingStatus(mapShiplogicStatus(raw));
}

// Human-friendly default messages for the timeline UI when the carrier
// doesn't send an explicit description. Keyed by collapsed status.
export const STATUS_LABEL: Record<string, string> = {
  // Internal milestones
  PAYMENT_RECEIVED: 'Payment received — funds held by Gun Galore',
  AWAITING_SELLER_DISPATCH: 'Awaiting seller dispatch',
  SELLER_DISPATCHED: 'Seller marked the parcel as dispatched',
  BUYER_CONFIRMED_DELIVERY: 'Buyer confirmed delivery',
  PAYOUT_RELEASED: 'Funds released to seller',
  // Booked / pre-movement
  SUBMITTED: 'Shipment submitted to the courier',
  BOOKED: 'Waybill created',
  DEPOSIT_PENDING: 'Awaiting deposit at a locker',
  AWAITING_DROPOFF: 'Awaiting drop-off',
  PUDO_PIN_ISSUED: 'Pudo collection PIN issued',
  COLLECTION_ASSIGNED: 'Collection scheduled',
  COLLECTION_EXCEPTION: 'Collection issue — courier following up',
  DELIVERY_ASSIGNED: 'Out with a delivery driver soon',
  ON_HOLD: 'On hold — courier follow-up in progress',
  FLOOR_CHECK: 'Verified at the depot',
  CANCELLED: 'Shipment cancelled',
  // Movement
  PARCEL_COLLECTED: 'Collected by the courier',
  PARCEL_DROPPED_OFF: 'Dropped off at a Pudo locker',
  PARCEL_IN_TRANSIT: 'In transit',
  AT_HUB: 'Arrived at a courier hub',
  AT_DESTINATION_HUB: 'Arrived at the destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  AT_LOCKER: 'Arrived at your collection locker',
  DELIVERED: 'Delivered',
  COLLECTED_BY_BUYER: 'Collected by the buyer',
  DELIVERY_EXCEPTION: 'Delivery exception — courier follow-up in progress',
  DELIVERY_FAILED: 'Delivery failed',
  UNDELIVERABLE: 'Undeliverable — courier follow-up in progress',
  PIN_EXPIRED: 'Pudo collection PIN expired',
  RETURN_INITIATED: 'Return to sender initiated',
  // Legacy
  AWAITING_TCG_COLLECTION: 'Awaiting collection by The Courier Guy',
  TCG_IN_TRANSIT: 'In transit with The Courier Guy',
  FAILED_DELIVERY: 'Delivery failed',
};
