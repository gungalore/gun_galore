// ─── Straight-line distance for the "how far from you" indicator ────────────
//
// The seller nominates the gunshop a firearm/barrel will be dealer-stocked at;
// the buyer needs a plain "≈560 km from you" so they can judge the trip before
// buying. That is a straight-line (haversine) figure on purpose: it is cheap,
// cacheable and needs no routing API call per listing view. The math lives in
// news-geo.ts and is reused rather than copied.

import { haversineKm } from '../news/news-geo';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Whole-kilometre straight-line distance between two points. */
export function distanceKm(a: LatLng, b: LatLng): number {
  return Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng));
}

/** The on-ad label. Coarse on purpose — never a precise pin. */
export function formatDistanceKm(km: number): string {
  return `≈${km.toLocaleString('en-ZA')} km`;
}
