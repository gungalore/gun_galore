// Single source of truth for carrier-status → internal-status mapping.
// Used by webhooks, the polling cron, and the tracking timeline.
//
// Two layers:
//   1. mapPudoStatus / mapTcgStatus → COLLAPSED internal vocabulary
//      (e.g. PARCEL_DROPPED_OFF, AT_LOCKER, COLLECTED_BY_BUYER).
//      Stored verbatim on TrackingEvent.status so the timeline UI has
//      something fine-grained to show.
//   2. toShippingStatus()          → Prisma ShippingStatus enum
//      (PENDING | COLLECTED | IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED |
//       DELIVERY_FAILED | RETURNED). Used to roll the
//      Transaction.shippingStatus field forward in lockstep with the
//      timeline so existing notifications / dispatch logic still works.
//
// IMPORTANT: keys are stored uppercase + underscores. The normaliser
// `normalise()` uppercases the input and replaces whitespace/hyphens
// with underscores BEFORE lookup, so callers can pass raw status strings
// exactly as the carrier sent them.

// ─── Pudo ────────────────────────────────────────────────────────────────────
// Pudo's published webhook + tracking-API statuses span the full locker
// journey. We collapse them into a handful of internal states the rest of
// the codebase reasons about:
//   PUDO_PIN_ISSUED       — booked, no parcel movement yet
//   PARCEL_DROPPED_OFF    — seller has dropped the parcel; "Shipped" to buyer
//   PARCEL_IN_TRANSIT     — Pudo trunk leg between source + destination locker
//   AT_LOCKER             — parcel is in the buyer's collection locker
//   COLLECTED_BY_BUYER    — buyer has opened the locker; "Delivered" to buyer
//   RETURN_INITIATED      — Pudo is returning the parcel to sender
//   DELIVERY_FAILED       — terminal failure
//   DELIVERY_EXCEPTION    — non-terminal exception (left at depot, etc)
//   PIN_EXPIRED           — PIN window lapsed
export const PUDO_STATUS_MAP: Record<string, string> = {
  CREATED: 'PUDO_PIN_ISSUED',
  LABEL_CREATED: 'PUDO_PIN_ISSUED',
  DROPPED_OFF: 'PARCEL_DROPPED_OFF',
  COLLECTED: 'PARCEL_DROPPED_OFF',
  IN_TRANSIT: 'PARCEL_IN_TRANSIT',
  ARRIVED_AT_LOCKER: 'AT_LOCKER',
  READY_FOR_COLLECTION: 'AT_LOCKER',
  COLLECTED_BY_RECIPIENT: 'COLLECTED_BY_BUYER',
  RETURNED: 'RETURN_INITIATED',
  FAILED: 'DELIVERY_FAILED',
  EXCEPTION: 'DELIVERY_EXCEPTION',
  EXPIRED: 'PIN_EXPIRED',
};

// ─── TCG ─────────────────────────────────────────────────────────────────────
// TCG's tracking lexicon overlaps but is broader. Mapping is permissive:
// many synonyms map to the same internal state so we don't drop events
// when TCG renames a status code.
export const TCG_STATUS_MAP: Record<string, string> = {
  COLLECTION_BOOKED: 'AWAITING_TCG_COLLECTION',
  BOOKED: 'AWAITING_TCG_COLLECTION',
  COLLECTED: 'TCG_IN_TRANSIT',
  IN_TRANSIT: 'TCG_IN_TRANSIT',
  ON_THE_WAY: 'TCG_IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  WITH_COURIER: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  POD: 'DELIVERED',
  FAILED: 'FAILED_DELIVERY',
  FAILED_DELIVERY: 'FAILED_DELIVERY',
  DELIVERY_FAILED: 'FAILED_DELIVERY',
  EXCEPTION: 'DELIVERY_EXCEPTION',
  HOLD: 'DELIVERY_EXCEPTION',
  ON_HOLD: 'DELIVERY_EXCEPTION',
};

// ─── Collapsed → Prisma ShippingStatus ───────────────────────────────────────
// Maps the fine-grained internal vocabulary down to the coarser
// Prisma enum that drives notifications + the buyer "delivered" gate.
// Anything not in this map leaves Transaction.shippingStatus alone
// (the timeline still records the event for visibility).
export type PrismaShippingStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED';

const COLLAPSED_TO_PRISMA: Record<string, PrismaShippingStatus> = {
  // Pudo
  PUDO_PIN_ISSUED: 'PENDING',
  PARCEL_DROPPED_OFF: 'COLLECTED',
  PARCEL_IN_TRANSIT: 'IN_TRANSIT',
  AT_LOCKER: 'OUT_FOR_DELIVERY',
  COLLECTED_BY_BUYER: 'DELIVERED',
  RETURN_INITIATED: 'RETURNED',
  PIN_EXPIRED: 'DELIVERY_FAILED',
  // TCG
  AWAITING_TCG_COLLECTION: 'PENDING',
  TCG_IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED_DELIVERY: 'DELIVERY_FAILED',
  // Shared
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  DELIVERY_EXCEPTION: 'IN_TRANSIT', // non-terminal — keep the parcel "in transit" from a notification POV
};

function normalise(raw: string): string {
  return (raw ?? '').toString().trim().toUpperCase().replace(/[\s\-]+/g, '_');
}

export function mapPudoStatus(raw: string): string {
  const key = normalise(raw);
  return PUDO_STATUS_MAP[key] ?? key;
}

export function mapTcgStatus(raw: string): string {
  const key = normalise(raw);
  return TCG_STATUS_MAP[key] ?? key;
}

/**
 * Roll the collapsed internal status down to the coarser Prisma
 * ShippingStatus enum. Returns null when no mapping exists — caller
 * should leave Transaction.shippingStatus untouched in that case.
 */
export function toShippingStatus(
  collapsed: string,
): PrismaShippingStatus | null {
  return COLLAPSED_TO_PRISMA[collapsed] ?? null;
}

// Human-friendly default messages for the timeline UI when the carrier
// doesn't send an explicit description with the event. Keyed by
// collapsed status.
export const STATUS_LABEL: Record<string, string> = {
  // Internal milestones
  PAYMENT_RECEIVED: 'Payment received — funds held by Gun Galore',
  AWAITING_SELLER_DISPATCH: 'Awaiting seller dispatch',
  SELLER_DISPATCHED: 'Seller marked the parcel as dispatched',
  BUYER_CONFIRMED_DELIVERY: 'Buyer confirmed delivery',
  PAYOUT_RELEASED: 'Funds released to seller',
  // Pudo
  PUDO_PIN_ISSUED: 'Pudo collection PIN issued',
  PARCEL_DROPPED_OFF: 'Parcel dropped off at a Pudo locker',
  PARCEL_IN_TRANSIT: 'In transit between Pudo lockers',
  AT_LOCKER: 'Arrived at your collection locker',
  COLLECTED_BY_BUYER: 'Collected by buyer',
  RETURN_INITIATED: 'Return to sender initiated',
  PIN_EXPIRED: 'Pudo collection PIN expired',
  // TCG
  AWAITING_TCG_COLLECTION: 'Awaiting collection by The Courier Guy',
  TCG_IN_TRANSIT: 'In transit with The Courier Guy',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  FAILED_DELIVERY: 'Delivery failed',
  DELIVERY_EXCEPTION: 'Delivery exception — courier follow-up in progress',
  DELIVERY_FAILED: 'Delivery failed',
};
