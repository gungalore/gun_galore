// Shared SEO copy for the generic browse surfaces (category pages, brand
// pages, the brand index). These strings are what Google prints under the
// blue link, so they are the first sentence most new buyers ever read — and
// the first thing a platform crawler reads when it decides what this site is.
//
// Why this file exists: each of those pages used to hard-code its own
// self-description, which stamped the same sentence onto Fishing, Camping and
// every other category. One constant means the framing can never drift apart
// again, and a reposition is a one-line edit instead of a grep.
//
// 2026-08 REPOSITIONING — read before editing:
//
// The word "firearms" USED to be in SITE_CATEGORY_KEYWORDS deliberately, on
// the reasoning that regulated stock is a real part of the catalogue and we
// should not hide it. That is no longer the right call for PUBLIC copy: these
// strings render on signed-out pages, which are exactly what crawlers and
// platform moderators read, and regulated categories are now members-only.
// Advertising firearms in the meta description of a page that cannot show
// firearms to the reader is both a policy problem and simply inaccurate.
//
// So: no firearm, ammunition or weapon words in this file, and no
// "marketplace" — the public identity is a STORE. None of this is compliance
// copy. The licence / dealer-transfer / age wording lives on the listing pages
// and the members-only Regulated Items Annex and must never be softened to
// match the tone here.

import { BRAND_NAME, BRAND_BLURB } from './brand';

/** How the site describes itself on generic (non-listing-specific) pages. */
export const SITE_MARKETPLACE_BLURB = BRAND_BLURB;

/** Breadth keywords for the public catalogue. Public trees only — anything
 *  members-only must not appear here (see the header note). */
export const SITE_CATEGORY_KEYWORDS =
  'camping, overlanding, fishing, optics, knives, clothing and outdoor gear';

/**
 * Meta description for a browse surface. `what` is the thing being browsed
 * and is dropped in mid-sentence, e.g. `'fishing listings'`,
 * `'Leupold gear for sale'`, `'gear by brand'`.
 *
 * Note the payment wording: "payment held until delivery" — never the word
 * "escrow" anywhere on this platform.
 */
export function browseMetaDescription(what: string): string {
  return `Browse ${what} on ${BRAND_NAME} — ${SITE_MARKETPLACE_BLURB}: ${SITE_CATEGORY_KEYWORDS}. New and used, with payment held until delivery.`;
}
