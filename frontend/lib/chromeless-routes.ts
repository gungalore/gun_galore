// ────────────────────────────────────────────────────────────────────
// PAGES THAT ARE NOT PART OF THE SHOP.
//
// ⚠️ ONE LIST, BECAUSE THE PER-COMPONENT COPIES DRIFTED. This rule used to
// live as a hand-written `pathname.startsWith('/witness')` inside PublicNav,
// PublicFooter and the Ask Boet host — three copies, and the two components
// that also needed it never got one. The result was a complaint from a
// witness on Android: a marketplace SEARCH BAR, a wishlist heart and a
// SHOPPING CART sitting across the top of a statutory statement, because
// MobileSearchBar renders on phones (`md:hidden`) and nobody testing on a
// desktop ever saw it. Adding a chromeless route must be one edit, not five.
//
// WHY THESE PAGES GET NO CHROME: /witness/* is opened by a member of the
// public who received an SMS. They are not a customer, not a member, and did
// not come here to browse. They are being asked, under a criminal-offence
// warning, whether somebody is fit to hold a firearm. Wrapping that in a
// firearms storefront invites a stranger to shop mid-statement, and — for a
// link from an unfamiliar sender — reads as the wrong site entirely, which is
// the difference between completing it and closing it.
// ────────────────────────────────────────────────────────────────────

export const CHROMELESS_PREFIXES = ['/witness'];

/** True when the page must render without any marketplace chrome. */
export function isChromelessRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return CHROMELESS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
