/**
 * Backend mirror of frontend/lib/brand.ts. Deliberately a separate file —
 * neither app imports the other — so keep the two in step by hand.
 *
 * The platform trades as ALL OUTDOOR. The registered company is still
 * GunGalore (Pty) Ltd; ECT s43 requires the REGISTERED name in public
 * disclosures, which is why both exist. A CIPC name change is a one-line edit
 * to LEGAL_ENTITY.
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
