// UX-1c — pre-purchase delivery estimate for the PDP.
//
// A presentational helper: it maps a listing's shipping shape to the delivery
// line shown under the price BEFORE checkout. All inputs (shippingMethods,
// isFirearm, collectionOnly) are already on the listing GET payload, so no
// extra fetch is needed.
//
// The transit-day windows mirror the backend post-purchase estimator
// (backend/src/shipping/delivery-estimate.ts — TRANSIT_BUSINESS_DAYS). Both
// are deliberately conservative upper bounds and are ALWAYS framed as an
// estimate, never a guarantee — dispatch timing is at the seller's discretion
// (and, on the manual-EFT rail, only starts once payment clears).

import type { Listing } from './types';

// Keep in sync with backend TRANSIT_BUSINESS_DAYS.
const TRANSIT_BUSINESS_DAYS = { PUDO: 5, TCG: 4 } as const;

export type ListingDeliveryEstimate =
  | { kind: 'FIREARM' }
  | { kind: 'COLLECTION' }
  | { kind: 'COURIER'; minDays: number; maxDays: number }
  | null;

export function getListingDeliveryEstimate(
  listing: Pick<
    Listing,
    | 'listingType'
    | 'isExperience'
    | 'isFirearm'
    | 'collectionOnly'
    | 'shippingMethods'
  >,
): ListingDeliveryEstimate {
  // Experiences are an on-site service on a fixed event date, not a parcel —
  // the ExperiencePanel already surfaces the date/location.
  if (listing.isExperience) return null;

  // Swaps have no purchase/dispatch — a two-way exchange ships per leg after
  // the swap is agreed + funded (flat swap service fee), so a purchase-style
  // "after dispatch" courier ETA would misdescribe the flow. The SwapPanel
  // owns delivery expectations for swaps; hide the pre-purchase estimate here
  // even when a courier method is listed.
  if (listing.listingType === 'SWOP') return null;

  // Firearms always route via a licensed dealer — no platform-estimable
  // courier transit; we show the method, not a window.
  if (listing.isFirearm) return { kind: 'FIREARM' };

  const methods = listing.shippingMethods ?? [];
  if (listing.collectionOnly || methods.includes('COLLECTION'))
    return { kind: 'COLLECTION' };

  const days: number[] = [];
  if (methods.includes('PUDO')) days.push(TRANSIT_BUSINESS_DAYS.PUDO);
  if (methods.includes('TCG')) days.push(TRANSIT_BUSINESS_DAYS.TCG);
  // Nothing platform-estimable (e.g. PRIVATE_ARRANGE only, or a swap leg).
  if (days.length === 0) return null;

  return { kind: 'COURIER', minDays: Math.min(...days), maxDays: Math.max(...days) };
}

// ---------------------------------------------------------------------------
// Bulky-goods copy interim (audit "Big projects" #4)
// ---------------------------------------------------------------------------
// ShippingMethod has no freight/bulky member, so an oversized item (trailers,
// off-road caravans — the only category-flagged collectionOnly branch today)
// can only be listed COLLECTION. Buyers read "Collection only" as "same city
// only" and skip R10k–R150k listings they would happily have had transported,
// which caps the highest-ticket non-firearm inventory.
//
// Nothing in the COLLECTION rail actually requires the BUYER to be the person
// who shows up. COLLECTION already does what a courier-by-arrangement needs:
// payment stays held until the buyer presses Confirm collection (the
// transaction page relabels the shared confirm-delivery endpoint —
// canConfirmCollection), and contact details are revealed post-payment so the
// two sides can coordinate. So the buyer may send their own transporter; this
// helper only decides whether we are allowed to SAY so.
//
// Honesty guard: Gun Galore books nothing and insures nothing on that leg.
// Copy consuming FREIGHT_OK must stay "arrange your own", never an offered
// service, and must never imply a quoted/booked freight rail exists.
//
// IN_PERSON_ONLY is the one COLLECTION case where the freight framing would be
// actively wrong advice: P4.3b forces a loose lithium battery over the
// dangerous-goods threshold (the `battery_wh` attribute — UN3480) into
// collection-only precisely BECAUSE carriers may not take it. Pointing that
// buyer at "book a transporter" pushes them toward an illegal shipment.
// `battery_wh` is defined on exactly one category (Overlanding → Dual-Battery
// & Solar, which is NOT itself collection-only) and sellers enter 0 for
// non-battery items there, so "collectionOnly + battery_wh > 0" identifies the
// DG case exactly and never catches a trailer.
export type CollectionMode = 'FREIGHT_OK' | 'IN_PERSON_ONLY' | null;

export function getCollectionMode(
  listing: Pick<
    Listing,
    | 'listingType'
    | 'isExperience'
    | 'collectionOnly'
    | 'shippingMethods'
    | 'attributes'
  >,
): CollectionMode {
  // Experiences are an on-site service, not a thing anyone collects.
  if (listing.isExperience) return null;
  // Swaps exchange per leg after the swap is agreed and the SwapPanel owns
  // that story — same carve-out getListingDeliveryEstimate makes above.
  if (listing.listingType === 'SWOP') return null;

  // Union of both signals, matching checkout-form's isCollection: the flag is
  // the snapshot, the method array is the belt-and-braces for older payloads.
  const isCollection =
    listing.collectionOnly ||
    (listing.shippingMethods ?? []).includes('COLLECTION');
  if (!isCollection) return null;

  // Coerce rather than duck-type: battery_wh is a NUMBER attribute today, but
  // a stringy "200" from a redefined attr must still trip the DG carve-out.
  const batteryWh = Number(listing.attributes?.battery_wh ?? NaN);
  if (Number.isFinite(batteryWh) && batteryWh > 0) return 'IN_PERSON_ONLY';

  return 'FREIGHT_OK';
}
