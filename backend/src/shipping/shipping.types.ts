/**
 * Carrier-neutral shipping shapes, shared by the Bob Go client, the adapter and
 * the orchestrator.
 *
 * Moved out of the retired pudo.service.ts (2026-09-24) — Pudo and The Courier
 * Guy are gone and Bob Go (door-to-door) is the only courier rail.
 */

export interface ParcelDims {
  /** centimetres */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** grams */
  weightGrams: number;
}

export interface ShippingQuote {
  /** Bob Go service_code for the chosen rate. Echoed into the shipment-create
   *  call later — saves us re-quoting. */
  serviceCode: string;
  /** Human-friendly name, e.g. "Door to door - Economy". */
  serviceName: string;
  /** ZAR cents — VAT-INCLUSIVE (matches what the buyer is charged). */
  priceCents: number;
  /**
   * Bob Go booking needs the provider and service tier REPLAYED from the quote
   * alongside serviceCode, and both vary per rate within a single quote
   * response. Null/undefined on non-courier sales.
   */
  providerSlug?: string;
  serviceLevelCode?: string;
  /** Buyer-selected option within the COURIER rail. */
  deliveryOption?: 'DOOR_CHEAPEST' | 'DOOR_FASTEST' | 'STORE_PICKUP';
  /** Required for STORE_PICKUP; the counter Bob Go must book to. */
  pickupPointLocationId?: number;
  /** Immutable rate/location details for receipts and admin review. */
  pickupPointSnapshot?: Record<string, unknown>;
}
