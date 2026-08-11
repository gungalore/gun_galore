// Shared SEO copy for the generic browse surfaces (category pages, brand
// pages, the brand index). These strings are what Google prints under the
// blue link, so they are the first sentence most new buyers ever read.
//
// Why this file exists: each of those pages hard-coded its own
// "South Africa's marketplace for firearms, optics, hunting and outdoor
// gear" line, which stamped *firearms* onto the SERP snippet for Fishing,
// Camping and every other outdoor category — telling the exact audience we
// are trying to win that the site is not for them (outdoor audit
// site-outdoor-ux-1). One constant means the framing can never drift apart
// again, and the next reposition is a one-line edit instead of a grep.
//
// Firearms stay in the sentence — they are a real, licence-regulated part of
// the catalogue and we do not hide them. They are simply no longer the first
// word on a page about tents. Nothing here is compliance copy; the licence /
// dealer-transfer / age wording lives on the listing and compliance pages and
// must never be softened to match this.

/** How Gun Galore describes itself on generic (non-firearm-specific) pages. */
export const SITE_MARKETPLACE_BLURB =
  "South Africa's outdoor, hunting and sport marketplace";

/** The breadth keywords, outdoor-first, firearms last. Keeps the snippet
 *  useful to crawlers without leading every category page with "firearms". */
export const SITE_CATEGORY_KEYWORDS =
  'camping, fishing, optics, knives, gear and firearms';

/**
 * Meta description for a browse surface. `what` is the thing being browsed
 * and is dropped in mid-sentence, e.g. `'fishing listings'`,
 * `'Leupold gear for sale'`, `'gear by brand'`.
 *
 * Note the payment wording: "payment held until delivery" — never the word
 * "escrow" anywhere on this platform.
 */
export function browseMetaDescription(what: string): string {
  return `Browse ${what} on Gun Galore — ${SITE_MARKETPLACE_BLURB}: ${SITE_CATEGORY_KEYWORDS}. Buy, bid or make an offer, with payment held until delivery.`;
}
