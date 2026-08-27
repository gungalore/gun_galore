// THE single source of truth for how this platform names itself.
//
// The site trades as ALL OUTDOOR and the registered company IS
// ALLOUTDOOR (PTY) LTD, reg 2026/639713/07 — a NEW entity registered at CIPC
// 2026-08. Trading name and registered name now match, so the ECT s43
// disclosure is a plain "ALLOUTDOOR (PTY) LTD (Reg. …)" rather than the
// "trading as" form used while the company was still GunGalore (Pty) Ltd.
//
// GunGalore (Pty) Ltd (reg 2026/393321/07) is a DIFFERENT legal entity and is
// being wound down. It must not appear anywhere in this codebase: contracts,
// merchant accounts, the accounting ledger and the TPPP application all belong
// to the new company now. If you find the old name in a legal page, it is a
// bug, not history.
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

/** Registered company — ECT s43 disclosure. Matches the trading name. */
export const LEGAL_ENTITY = 'ALLOUTDOOR (PTY) LTD';
export const LEGAL_REG_NO = '2026/639713/07';

/**
 * ECT s43 line. The registered and trading names now match, so no "trading as"
 * qualifier is needed — using one would imply a separate operating company.
 */
export const LEGAL_DISCLOSURE = `${LEGAL_ENTITY} (Reg. ${LEGAL_REG_NO})`;

/** One-line self-description. STORE, not marketplace — the whole point of the
 *  repositioning. Auctions and offers remain features of the store rather than
 *  the headline identity. */
export const BRAND_TAGLINE = 'New and secondhand outdoor gear';

/** Longer blurb for meta descriptions and the footer. */
export const BRAND_BLURB =
  "South Africa's new and secondhand outdoor store";

/**
 * Subscription tier name. Was "GG PRO" — GG meant Gun Galore, the wound-down
 * entity, so the tier was still advertising it on the pricing page.
 *
 * This is the LABEL only. The persisted `SubscriptionTier.PRO` enum value, the
 * `pro_draw_enabled` flag key and every `tier === 'PRO'` check stay as they
 * are — renaming a stored value breaks rows, renaming a label does not.
 */
export const PRO_NAME = 'AO PRO';

/**
 * Support mailbox — the reply-to we print in emails, receipts, the footer and
 * takedown notices.
 *
 * Moved to alloutdoor.co.za on 2026-08-16, after the operator confirmed the
 * mailbox is live. The order mattered: this address RECEIVES, so it needed a
 * real mailbox behind it, not just the sending records Resend added. Mail for
 * alloutdoor.co.za is hosted at Absolute Hosting (MX s1.ahmail.co.za) — which
 * is why Resend's SPF sits on the `send` subdomain and the apex was left
 * alone. Pointing buyers at an address nobody reads is worse than an
 * off-brand one that works, so do not move this ahead of the mailbox again.
 */
export const SUPPORT_EMAIL = 'support@alloutdoor.co.za';

/**
 * Canonical public origin, no trailing slash.
 *
 * Everything that has to name the site's own URL reads this — `metadataBase`,
 * the canonical link, og:url, and the manifest's `related_applications`. It
 * lived in two places before and one of them was missed at the domain move,
 * which is precisely the drift this constant exists to stop.
 *
 * The env var is set on production; the fallback is only for a local build
 * with no env, so it names the CURRENT domain rather than the retired one.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  'https://alloutdoor.co.za';

/**
 * The payment reassurance line, held here until card payments go live.
 *
 * ⚠️ PHRASING IS FIXED BY OPERATOR RULE (2026-08-15) — say when the SELLER IS
 * PAID. Never "we hold your payment", never the word "escrow", anywhere on a
 * public surface. Marketing describes the payout trigger; only the in-flow
 * and legal pages describe funds being held.
 *
 * NOT ON ANY PUBLIC SURFACE YET, and that is deliberate: checkout returns 503
 * while PAYMENTS_LIVE is false, so this is a promise about a flow that does
 * not run. It is the strongest line we have for the objection buyers actually
 * arrive with ("what if I get scammed?"), so it goes up the day payments are
 * switched on — and not a day before.
 *
 * It used to live in components/trust-banner.tsx alongside the homepage
 * "Shop with confidence" card. That card was removed on 2026-08-27 (operator)
 * and the file deleted; the constant moved here so the rule and the go-live
 * instruction survive the card.
 */
export const PAYMENT_TRUST_POINT =
  'Sellers are only paid once you confirm delivery';
