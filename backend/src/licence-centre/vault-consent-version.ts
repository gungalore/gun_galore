/**
 * WHICH WORDING OF THE DOCUMENT-CENTRE CONSENT IS CURRENT.
 *
 * ⚠️ BUMP THIS WHEN WHAT WE DO WITH SOMEBODY'S DOCUMENTS CHANGES — not when a
 * comma moves. Bumping re-asks everybody; failing to bump after a real change
 * leaves stored rows pointing at text nobody can reconstruct, which is the
 * same as having no record at all.
 *
 * That has already happened in this codebase. The KYC consent copy was
 * rewritten once — it used to name no processor and no cross-border transfer —
 * and every row recorded before the rewrite now points at wording that no
 * longer exists, because there was no version to pin it to.
 *
 * ⚠️ SERVER-STAMPED, NEVER CLIENT-SUPPLIED. User.consentPolicyVersion is
 * client-supplied and sat frozen at 2026-07-17 while both policies it named
 * moved underneath it. A version the client can choose is not evidence of
 * anything.
 */
export const VAULT_CONSENT_VERSION = '2026-08-23';
