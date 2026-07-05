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
