/**
 * Fallback vicinity — the town label used when no postal area can be resolved.
 *
 * WHY NOT THE RAW CITY/SUBURB FIELD. Google's `locality` for a Kraaifontein
 * address is "Cape Town", which tells a buyer nothing useful. The postal-code
 * resolver (postal-locality.ts) runs first and names the area ("Kraaifontein");
 * this helper is the town-level fallback for codes we cannot resolve.
 *
 * It also stays the sanitiser. A Google Places "city" should never carry a
 * street or unit number, but the fields can also be hand-typed, and publishing
 * "12 Kruis Street, Centurion" as a location would leak the exact address.
 * Refuse anything containing a digit or a comma rather than trying to strip
 * it — a listing with no area is a fixable problem, a listing that published
 * someone's street address is not.
 *
 * `pickupSuburb` remains on PUBLIC_LISTING_SELECT's NEVER list. It may be used
 * internally to pick between the place names attached to one postal code, but
 * it is never returned to a buyer on its own.
 */
export function toPublicLocality(city?: string | null): string | null {
  const t = (city ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  // Defensive. A Google Places "city" should never carry a street or unit
  // number, but pickupCity can also be hand-typed, and publishing "12 Kruis
  // Street, Centurion" as a town would leak the exact address this helper
  // exists to withhold. Refuse anything containing a digit or a comma rather
  // than trying to strip it — a listing with no town is a fixable problem, a
  // listing that published someone's street address is not.
  if (/[0-9,]/.test(t)) return null;
  return t.slice(0, 80);
}
