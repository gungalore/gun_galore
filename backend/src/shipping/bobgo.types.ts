// Bob Go — shared shapes.
//
// Every field here was observed against the live sandbox on 2026-08-13, not
// copied from documentation. Where a value is inferred rather than seen, the
// comment says so.
//
// Bob Go replaces BOTH Pudo (lockers) and TCG (door) — it aggregates
// door-to-door and pickup-point delivery behind one API, so the two-carrier
// split in carrier.types.ts collapses into this one client.

/** A normalised address for quoting and booking. */
export interface BobGoAddress {
  company?: string;
  streetAddress: string;
  /** Suburb / sub-locality — sent as `local_area`. */
  suburb: string;
  city: string;
  /** Province. The API echoes back the 2-letter form ("WC", "GP"). */
  province: string;
  /** 4-digit SA postal code — sent as `code`. */
  postalCode: string;
  country?: string;
}

export interface BobGoContact {
  name: string;
  mobile: string;
  email?: string;
}

export interface BobGoParcel {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  description?: string;
}

/**
 * One quoted option. Bob Go returns door and pickup-point rates TOGETHER
 * from a single /rates-at-checkout call — the pickup points near the
 * delivery address arrive already priced and already carrying their
 * distance, so there is no separate "find lockers then price them" step
 * the way PudoService needs.
 */
export interface BobGoRate {
  /** Numeric rate id. Also embedded inside serviceCode. */
  id: number;
  /** e.g. "Standard shipping", or "Bob Box Locker – 44 on Stanley (approx. 0.1 km)". */
  serviceName: string;
  /**
   * The token echoed back at booking time.
   *
   * VERIFIED STABLE (2026-08-13): identical across repeated quotes for the
   * same route + service, so it can be persisted at checkout and replayed
   * when the seller accepts, days later. This is what makes the existing
   * book-at-seller-accept design survive the port.
   *
   * Shapes seen:
   *   door         bobgo_3082_34_0
   *   pickup-point bobgo_PP_3084_104_545_1   <- 545 is the locker's location id
   */
  serviceCode: string;
  /** Total in ZAR. See the caveat on BobGoQuote.pricingVerified. */
  totalPrice: number;
  baseRate: number;
  currency: string;
  /** 'door' or 'pickup-point'. */
  type: 'door' | 'pickup-point';
  /** Carrier tier code, e.g. "ECO", "BOXM-M". Stable alongside serviceCode. */
  serviceLevelCode: string;
  /** Which underlying courier fulfils this rate ("demo" in sandbox). */
  providerSlug: string;
  serviceLevelPriority?: number;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  /** Pickup-point rates only — the locker this rate delivers to. */
  pickupPointLocationId?: number;
  /** Pickup-point rates only — km from the delivery address. */
  pickupPointDistanceKm?: number;
  /** Human-readable address + trading hours (pickup-point rates). */
  description?: string;
  liabilityCoverPrice: number;
  surchargeTotal: number;
}

export interface BobGoQuote {
  rates: BobGoRate[];
  /**
   * FALSE until we have observed a quote that actually carries surcharges or
   * liability cover. Every sandbox quote so far returned `surcharges: []`
   * (door) or `null` (pickup-point) with `liability_cover.price: 0`, and
   * `total_price === base_rate` — which is consistent BOTH with "total
   * includes extras" and with "there were no extras". Until a quote proves
   * it, treat totalPrice as possibly under-collecting and reconcile against
   * the charged amount after collection.
   */
  pricingVerified: boolean;
}

/**
 * A pickup point (locker or counter).
 *
 * Bob Go's /locations is size-aware: pass the stacked parcel dimensions and
 * it reports, per location, whether a compartment is actually available.
 * PudoService cannot do this — today a buyer can be sent to a locker their
 * parcel will not fit into, and it is only discovered at drop-off.
 */
export interface BobGoLocation {
  id: number;
  name: string;
  /** Trading name, where it differs from the site name. */
  humanName?: string;
  lat: number;
  lng: number;
  type: string;
  address: string;
  fullAddress?: string;
  tradingHours?: string;
  providerName?: string;
  active: boolean;
  /**
   * Non-empty means this location CANNOT take the parcel — the value seen
   * is ["no_available_compartments"]. Callers must filter on this before
   * offering the location, not merely display it.
   */
  compartmentErrors: string[];
  /** Straight-line km, when the caller supplied coordinates. */
  distanceKm?: number;
}

/**
 * How far a booking actually got.
 *
 * THIS IS THE MOST IMPORTANT TYPE IN THE FILE. Bob Go returns HTTP 201 with
 * `app_status: "completed"` for a shipment the courier never accepted — the
 * sandbox booking came back created-and-successful while also carrying
 * `submission_status: "no-rates"` and `failed_reason: "No valid rates
 * received from Demo Couriers"`.
 *
 * A 201 therefore means "we recorded your request", NOT "a courier is
 * coming". Treating the two as the same would tell a seller their collection
 * is booked, print a waybill, and SMS the buyer a tracking reference for a
 * shipment that does not exist. Both Pudo and TCG return booked-or-error, so
 * this is genuinely new behaviour the port has to model rather than inherit.
 */
export type BobGoSubmissionState =
  /** Courier accepted it — safe to tell the seller and the buyer. */
  | 'SUBMITTED'
  /** Created but not yet accepted. Poll or await the webhook. Tell nobody yet. */
  | 'PENDING'
  /** Courier refused it. `failedReason` explains. Needs the manual rail. */
  | 'FAILED';

export interface BobGoShipmentResult {
  /** Bob Go's internal shipment id — used for waybill, cancel, and polling. */
  shipmentId: number;
  /** The reference the buyer tracks with. Present even when submission failed. */
  trackingReference: string;
  submission: BobGoSubmissionState;
  /** Raw `submission_status` for logging — the vocabulary is not yet enumerated. */
  rawSubmissionStatus: string;
  /** Human explanation when submission is FAILED. */
  failedReason?: string;
  /**
   * Locker collection PIN, if Bob Go issues one.
   *
   * UNVERIFIED. No PIN, QR, OTP or barcode field appeared on a sandbox
   * shipment, and `reservation_details` was null — but the submission had
   * failed, so no compartment was ever reserved. Until a booking succeeds
   * against a working provider we do not know whether a PIN exists, so
   * callers must handle undefined rather than assume one.
   */
  pin?: string;
  /** Pickup-point reservation payload, when present. Shape unverified. */
  reservationDetails?: unknown;
  providerSlug?: string;
  serviceLevelCode?: string;
}

/**
 * Tracking. The five movement events below are the skeleton Bob Go exposes;
 * the exhaustive `status` string vocabulary is NOT yet known, so
 * `statusFriendly` is what should be shown to a human and `status` should
 * only ever be mapped defensively.
 */
export interface BobGoTracking {
  trackingReference: string;
  status: string;
  statusFriendly: string;
  courierName?: string;
  /** Pickup-point specific — the parcel is in the locker awaiting collection. */
  readyForPickup: boolean;
  collectedTime?: string;
  inTransitTime?: string;
  outForDeliveryTime?: string;
  readyForPickupTime?: string;
  deliveredTime?: string;
  checkpoints: { time?: string; status?: string; message?: string }[];
}
