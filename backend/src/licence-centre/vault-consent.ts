import { VAULT_CONSENT_VERSION } from './vault-consent-version';

// ────────────────────────────────────────────────────────────────────
// MAY WE KEEP THE PAPERWORK FROM YOUR APPLICATIONS?
//
// Operator, 2026-08-22: "we also need to launch a window asking the user for
// us to keep the documents and explain why."
//
// ⚠️ NOBODY HAD EVER BEEN ASKED. Documents attached to a licence application
// were already retained past it and already offered back on the next one, and
// no record anywhere said a member had agreed to any of it. This module is the
// gate that fixes that.
//
// ⚠️ IT IS A COMPARISON, NOT A NULL CHECK, and that is the whole design. Three
// things fall out of it that a bare timestamp cannot give:
//
//   A DECLINE IS RECORDED. The version is stamped on BOTH answers, so "they
//   said no to this wording" is a fact we hold — which is what lets us ask
//   once and then leave them alone.
//
//   A WORDING CHANGE RE-ASKS. Nothing in this codebase compares
//   consentPolicyVersion against the current policy version, which is exactly
//   why it sat frozen while the policies moved.
//
//   STALE FAILS SOFT. A member on old wording keeps everything already kept
//   and simply stops accruing new documents until they have read the new text.
//   Silently deleting a feature over a wording change is worse than a banner.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

export type VaultConsentState =
  /** Never seen any version of the window. */
  | 'never-asked'
  /** Answered the CURRENT wording with no. */
  | 'declined'
  /** Answered the current wording with yes. */
  | 'given'
  /** Said yes to an older wording; the text has materially changed since. */
  | 'stale'
  /** Said yes once and turned it off since. */
  | 'withdrawn';

export interface VaultConsentFields {
  documentVaultConsentAt: Date | null;
  documentVaultConsentVersion: string | null;
  documentVaultConsentWithdrawnAt: Date | null;
}

export function vaultConsentState(u: VaultConsentFields): VaultConsentState {
  // ⚠️ WITHDRAWAL WINS OVER EVERYTHING, including a current version stamp.
  // Turning it off is the most recent thing they said, and re-asking somebody
  // who has just switched something off is how a preference stops meaning
  // anything.
  if (u.documentVaultConsentWithdrawnAt) return 'withdrawn';
  const current = u.documentVaultConsentVersion === VAULT_CONSENT_VERSION;
  if (u.documentVaultConsentAt) return current ? 'given' : 'stale';
  // No consentAt but a version stamp means they answered — with a no.
  return current ? 'declined' : 'never-asked';
}

/**
 * May we keep documents from their applications, right now?
 *
 * ⚠️ THE ONLY FUNCTION THAT MAY GATE KEEPING. Every call site asks this
 * rather than reading a column, so there is one place to be wrong.
 */
export function mayKeep(state: VaultConsentState): boolean {
  return state === 'given';
}

/**
 * Should we put the window in front of them?
 *
 * Not for `declined` and not for `withdrawn` — they have answered, and asking
 * again is nagging. Not for `given` either, obviously.
 */
export function mustAsk(state: VaultConsentState): boolean {
  return state === 'never-asked' || state === 'stale';
}

/**
 * Does cross-application reuse still apply while we have not asked?
 *
 * ⚠️ YES, AND THIS IS A DELIBERATE OPERATOR-FACING DECISION. Reuse across
 * applications is what the product already does; switching it off for
 * everybody the moment this ships would take a working feature away from
 * people who have not been asked anything yet, to punish them for our
 * omission. So the narrowing bites on `declined` and `withdrawn` — the two
 * states where somebody has actually said no — and `never-asked` carries on
 * as today until they answer.
 *
 * No NEW processing begins without a yes: nothing is copied into the Centre,
 * and nothing outlives its application's retention clock, unless they agree.
 */
export function mayOfferAcrossApplications(state: VaultConsentState): boolean {
  return state !== 'declined' && state !== 'withdrawn';
}
