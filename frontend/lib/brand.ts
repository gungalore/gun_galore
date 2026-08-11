// THE single source of truth for how this platform names itself.
//
// The site trades as ALL OUTDOOR — a new-and-secondhand outdoor store. The
// registered company behind it is still GunGalore (Pty) Ltd, and ECT s43
// requires the REGISTERED name (not the trading name) to be disclosed on every
// page, so both live here and the footer renders "All Outdoor, a trading name
// of GunGalore (Pty) Ltd". If/when CIPC approves a company-name change, that
// is a one-line edit to LEGAL_ENTITY and nothing else moves.
//
// Why a constant module and not a find-and-replace: the name appears in page
// titles, OG tags, the PWA manifest, every transactional email and SMS, and
// the legal disclosures. A grep-and-hope rebrand leaves stragglers in the
// places nobody looks — an SMS template, a fallback title — and a straggler
// here is the exact firearm signal this repositioning exists to remove.
//
// Backend has a mirror of this file at backend/src/common/brand.ts. Keep them
// in step; they are deliberately separate so neither app imports the other.

/** Trading name. What users, crawlers and customers see everywhere. */
export const BRAND_NAME = 'All Outdoor';

/** Registered company — ECT s43 disclosure only. Swap after a CIPC change. */
export const LEGAL_ENTITY = 'GunGalore (Pty) Ltd';
export const LEGAL_REG_NO = '2026/393321/07';

/**
 * ECT s43 line. Uses the "trading as" form so the disclosure stays accurate
 * while the site presents under its trading name.
 */
export const LEGAL_DISCLOSURE = `${BRAND_NAME}, a trading name of ${LEGAL_ENTITY} (Reg. ${LEGAL_REG_NO})`;

/** One-line self-description. STORE, not marketplace — the whole point of the
 *  repositioning. Auctions and offers remain features of the store rather than
 *  the headline identity. */
export const BRAND_TAGLINE = 'New and secondhand outdoor gear';

/** Longer blurb for meta descriptions and the footer. */
export const BRAND_BLURB =
  "South Africa's new and secondhand outdoor store";
