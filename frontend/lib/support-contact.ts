// ─── Support contact details (single source for all public pages) ─────
//
// ⚠️ PLACEHOLDER NUMBER (operator 2026-07-23): a dedicated support line is
// being provisioned; until then this placeholder shows on the public pages
// (contact, support, complaints, PAIA). Swap BOTH values here when the
// real number arrives — every page updates from this file. Never publish a
// personal cell here.
export const SUPPORT_PHONE_DISPLAY = '+27 87 550 0000';
export const SUPPORT_PHONE_TEL = '+27875500000';

// The address itself lives in lib/brand.ts alongside EMAIL_FROM — both move
// together at the DNS cutover, so keeping them in one file stops half a
// rebrand shipping. Re-exported here because the legal pages already import
// their phone details from this module.
export { SUPPORT_EMAIL } from './brand';
