import { verifyToken, VerifyTokenOptions } from '@clerk/backend';

/**
 * Single place every guard verifies a Clerk session token.
 *
 * Adds OPTIONAL authorized-party (azp) validation: set
 * CLERK_AUTHORIZED_PARTIES to a comma-separated list of the origins that are
 * allowed to mint sessions for this API (e.g.
 * "https://gungalore.co.za,capacitor://localhost,ionic://localhost"). When
 * set, a token whose azp claim is not in the list is rejected — defence
 * against cross-origin token reuse on a shared Clerk instance.
 *
 * It is DELIBERATELY opt-in: unset ⇒ azp is not checked (Clerk's default), so
 * we can never accidentally lock out the Capacitor app shells (whose azp is a
 * `capacitor://` / `ionic://` scheme) by forgetting to enumerate one of their
 * origins. Read at call time so it picks up env after dotenv/bootstrap.
 */
export function verifyClerkToken(token: string) {
  const parties = process.env.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const opts: VerifyTokenOptions = {
    secretKey: process.env.CLERK_SECRET_KEY,
  };
  if (parties && parties.length) opts.authorizedParties = parties;
  return verifyToken(token, opts);
}
