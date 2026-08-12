/**
 * Backend mirror of frontend/lib/brand.ts. Deliberately a separate file —
 * neither app imports the other — so keep the two in step by hand.
 *
 * The platform trades as ALL OUTDOOR and the registered company is
 * ALLOUTDOOR (PTY) LTD (reg 2026/639713/07, CIPC 2026). ECT s43 requires the
 * REGISTERED name in public disclosures, which is why both constants exist.
 * The old GunGalore (Pty) Ltd entity is a SEPARATE company being wound down —
 * it is not this business and must not appear anywhere in outbound comms.
 *
 * Used for outbound comms (email from-name, SMS prefix, document headers)
 * where a stale brand name is the most visible kind of miss: a customer who
 * gets an SMS signed "Gun Galore" after the rebrand has been told, in the
 * clearest possible terms, that the two are the same business.
 */

/** Trading name — what customers see. */
export const BRAND_NAME = 'All Outdoor';

/** Registered company. ECT s43 disclosure only. */
export const LEGAL_ENTITY = 'ALLOUTDOOR (PTY) LTD';
export const LEGAL_REG_NO = '2026/639713/07';

/**
 * SMS prefix. Every outbound SMS opens with this so the recipient knows who
 * is texting before they read the body — and because SA networks give us no
 * alphanumeric sender ID, the body is the ONLY place the brand can appear.
 */
export const SMS_PREFIX = `${BRAND_NAME}:`;

/**
 * Email From header. NOTE the domain is still gungalore.co.za and stays that
 * way until the domain migration — changing the from-domain without matching
 * SPF/DKIM/DMARC records would put every transactional email in spam.
 */
export const EMAIL_FROM = `${BRAND_NAME} <noreply@gungalore.co.za>`;

/**
 * Support mailbox — the reply-to address we print in emails, receipts and
 * takedown notices. Same domain reasoning as EMAIL_FROM: gungalore.co.za mail
 * is live, alloutdoor.co.za is not wired yet, so the value moves with the DNS
 * cutover rather than ahead of it. One edit here, not twenty-five.
 */
export const SUPPORT_EMAIL = 'support@gungalore.co.za';

/**
 * Subscription tier name. Was "GG PRO" — GG meant Gun Galore, the wound-down
 * entity. LABEL ONLY: the `SubscriptionTier.PRO` enum, the `pro_draw_enabled`
 * flag key and every `tier === 'PRO'` comparison are persisted values and stay
 * exactly as they are.
 */
export const PRO_NAME = 'AO PRO';
