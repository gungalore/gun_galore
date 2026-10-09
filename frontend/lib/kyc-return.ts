/**
 * Where the member lands after identity verification.
 *
 * ⚠️ DIDIT'S CALLBACK DROPS OUR QUERY STRING. It returns the member to
 * `/kyc/verify?returned=1&verificationSessionId=…&status=…`, so the
 * `returnTo` they arrived with is gone by the time they are back. The verify
 * page parks it under `KYC_RETURN_KEY` the moment it first sees it and reads it
 * again on the callback.
 */

/** localStorage key holding the member's origin across the Didit round-trip. */
export const KYC_RETURN_KEY = 'kyc.returnTo';

/**
 * Accept only a same-origin relative path as a return target.
 *
 * ⚠️ `returnTo` arrives in a URL and feeds `router.push` (and localStorage), so
 * an unchecked value is an open redirect: `//evil.example` or a full
 * `https://…` would send a just-verified member off-site. A single leading
 * slash — never a second one — is the whole rule.
 */
export function safeReturnPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.startsWith('/') && !value.startsWith('//') ? value : null;
}

/**
 * Is this the identity-verification page arriving without a member session —
 * either authorised by an action token (`?t=`, the SMS/QR handoff) or as
 * Didit's hosted-page return (`?returned=1`)?
 *
 * ⚠️ THIS IS THE ONE EXEMPTION THE KYC ROUTE GETS FROM THE AUTH WALL, and it
 * is deliberately narrow: the exact path plus one of exactly two markers. The
 * page reads no member data on this branch. Keeping it here, next to the
 * return-path guard and its spec, is what stops `?returned` from being
 * mistyped into a wildcard that publishes the whole wizard.
 */
export function isSessionFreeKycLanding(
  pathname: string,
  search: URLSearchParams,
): boolean {
  return (
    pathname === '/kyc/verify' &&
    (search.has('t') || search.get('returned') === '1')
  );
}
