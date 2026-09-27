// ────────────────────────────────────────────────────────────────────
// PAGES THAT ARE DOCUMENTS, NOT SHOP SURFACES.
//
// The shop-mode bar (Buy Now / Auctions / Armory) is a fork for browsing.
// On a policy or disclosure page the visitor is reading a document, not
// shopping — dropping a storefront bar above the terms is the same mistake
// lib/chromeless-routes.ts exists to prevent, one notch less severe: here
// there is no statutory statement to protect, so the nav and footer stay,
// but the shop fork does not belong.
//
// ⚠️ ONE LIST, FOR THE SAME REASON chromeless-routes.ts IS ONE LIST. These
// URLs are FLAT — the (legal) route group does not put a /legal prefix in
// the URL — so they cannot be detected by prefix and must be enumerated.
// Enumerating them in one place means adding a policy page is one edit.
//
// /members/regulated-items is included because its layout deliberately
// mirrors the (legal) one and it reads as a document, not a shop page.
//
// /checkout is NOT here: it is a focused flow, not fine print, so it is
// excluded by the bar component itself for a different reason.
// ────────────────────────────────────────────────────────────────────

/** Exact paths that are read-only documents rather than shop surfaces. */
export const FINE_PRINT_PATHS = new Set([
  '/privacy',
  '/terms',
  '/aml-policy',
  '/acceptable-use',
  '/refund-policy',
  '/buyer-protection',
  '/data-deletion',
  '/cookies',
  '/legal',
  '/community-guidelines',
  '/paia',
  '/contact',
  '/complaints',
  '/regulated-categories',
  '/fees',
  '/about',
  '/how-payments-work',
  '/firearms-compliance',
  '/members/regulated-items',
]);

/** True when the page is a document, not a shop surface. */
export function isFinePrintRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  // ⚠️ EXACT MATCH ONLY — this is a set lookup, not a subtree walk. A child
  // of a listed page (e.g. a hypothetical /complaints/new) is NOT covered by
  // its parent and would have to be listed itself. Say so here rather than
  // implying a prefix rule the code does not implement.
  // Trailing slashes are rare here but a bare match is cheap.
  const clean = pathname !== '/' && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  return FINE_PRINT_PATHS.has(clean);
}
