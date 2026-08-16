/**
 * Public vicinity — the coarse town label a buyer sees before they pay.
 *
 * WHY TOWN AND NOT SUBURB. The decision a buyer is making is "am I driving to
 * this?" — Bloemfontein versus Cape Town settles that; Fichardt Park versus
 * Universitas does not. Suburb is where doxxing starts: in a small town or on a
 * smallholding, suburb plus town narrows a residential address to a handful of
 * properties. pickupSuburb is on PUBLIC_LISTING_SELECT's explicit NEVER list
 * with a regression test holding it there, and this helper exists so that stays
 * true while buyers still learn which town they would be travelling to.
 *
 * It is also the same resolution firearms already publish — the planned dealer
 * is shown as "Dealer Name — Centurion, Gauteng" — so the whole site discloses
 * location at one granularity.
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
