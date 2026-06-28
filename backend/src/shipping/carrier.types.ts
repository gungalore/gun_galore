// Shared shapes for booking a real shipment with a carrier (Pudo L2L or
// TCG D2D). Both carriers run on the ShipLogic platform, so the create
// flow + response are the same shape; only the base URL, auth, and the
// collection/delivery legs differ. Kept carrier-neutral so the booking
// orchestrator (Phase 2) doesn't branch on carrier internals.

/** A collection or delivery contact for a shipment. */
export interface CarrierContact {
  name: string;
  /** Optional — ShipLogic accepts a blank email. */
  email?: string;
  /** SA mobile number (the seller's for collection, buyer's for delivery). */
  mobile: string;
}

/** Normalised result of a successful shipment booking. */
export interface CarrierShipmentResult {
  carrier: 'PUDO' | 'TCG';
  /** ShipLogic shipment id — used to fetch the waybill/label PDF + to cancel. */
  shipmentId: string;
  /** The waybill / tracking number the carrier issued. Doubles as the
   *  `waybill` query param the tracking poll already uses. */
  trackingReference: string;
  /** Pudo locker drop-off / collection PIN. Undefined for TCG door-to-door
   *  (the courier collects from the seller's address — no PIN). */
  pin?: string;
  /** Carrier-reported shipment status at creation, if present. */
  status?: string;
}
