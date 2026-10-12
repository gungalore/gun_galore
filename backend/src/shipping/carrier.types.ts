// Shared shapes for booking a real shipment with a carrier. The only courier
// rail is Bob Go (door-to-door). Kept carrier-neutral so the booking
// orchestrator doesn't branch on carrier internals.

/**
 * A street address in the shape the ShipLogic-family API expects.
 *
 * Rescued out of the retired carrier client when that integration was removed
 * (operator 2026-09-04). Despite living there and being named for that carrier,
 * it was never specific to it: Bob Go quoting and booking use it just as much,
 * because both run on ShipLogic and want the same long-form province. Deleting
 * the old client with the type still inside it would have taken the live rail's
 * address shape with it.
 */
export interface CarrierAddress {
  /** Street + number; required. */
  streetAddress: string;
  /** Suburb / sub-locality — sent as `local_area`. */
  suburb: string;
  /** City / town. */
  city: string;
  /** SA province as a long-form name (e.g. "Western Cape", "Gauteng").
   *  ShipLogic accepts both the long name and the 2-letter abbreviation;
   *  the long name is what the carriers' own examples use. */
  province: string;
  /** 4-digit SA postal code. */
  postalCode: string;
  /** Coordinates — ShipLogic uses these for distance + suburb
   *  validation; omit and the API may still quote but routing
   *  accuracy drops. */
  lat?: number;
  lng?: number;
  /** "residential" or "business". Defaults to residential. */
  type?: 'residential' | 'business';
  /** Company name when type==='business'. */
  company?: string;
}

/** A collection or delivery contact for a shipment. */
export interface CarrierContact {
  name: string;
  /** Optional — ShipLogic accepts a blank email. */
  email?: string;
  /** SA mobile number (the seller's for collection, buyer's for delivery). */
  mobile: string;
}

/** Normalised result of a shipment booking attempt. */
export interface CarrierShipmentResult {
  /**
   * WHICH carrier API actually holds this shipment. Persisted to
   * Transaction.carrierProvider, and what every later operation (waybill,
   * cancel, tracking) must route on. Only Bob Go remains.
   */
  provider: 'BOBGO';
  /**
   * How far the booking actually got.
   *
   * Bob Go returns HTTP 201 for shipments the courier then refuses, so it can
   * report 'PENDING' (created, not yet accepted — tell nobody) or 'FAILED'
   * (refused) as well as 'SUBMITTED'.
   *
   * Callers must not stamp shipmentBookedAt, print a waybill, or notify the
   * seller on anything other than 'SUBMITTED'.
   */
  submission: 'SUBMITTED' | 'PENDING' | 'FAILED';
  /** Why the carrier refused, when submission is 'FAILED'. */
  failedReason?: string;
  /** Bob Go shipment id — used to re-read/cancel the shipment. */
  shipmentId: string;
  /** The waybill / tracking number the carrier issued. Doubles as the
   *  `tracking_reference` the tracking poll and webhooks match on. */
  trackingReference: string;
  /** Collection / locker PIN, when the carrier issued one. Usually absent for
   *  a door shipment. */
  pin?: string;
  /** Carrier-reported shipment status at creation, if present. */
  status?: string;
}
