/**
 * Single source of truth for the member session-JWT secret.
 *
 * Deliberately a copy of the shape of `adminJwtSecret()` rather than a shared
 * helper: the two secrets must be DIFFERENT values, and a single function
 * taking a variable name is one typo away from signing member sessions and
 * admin sessions with the same key — at which point a member token verifies
 * on an admin route.
 *
 * In production a missing / empty / known-default secret THROWS, so the auth
 * surface fails closed (main.ts asserts the same at bootstrap for a clean,
 * obvious startup failure rather than a 500 on the first sign-in).
 *
 * In development a fixed throwaway keeps local sign-in working with zero
 * per-developer config. It is explicitly NOT usable in production.
 */
const KNOWN_BAD = 'dev-member-secret-change-in-prod';
const DEV_FALLBACK = 'dev-only-member-secret-NOT-for-production';

export function memberJwtSecret(): string {
  const s = process.env.JWT_MEMBER_SECRET;
  if (s && s.trim().length > 0 && s !== KNOWN_BAD) {
    return s;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_MEMBER_SECRET must be set to a strong, non-default value in production. ' +
        'Refusing to start with a missing/empty/default member secret.',
    );
  }
  return DEV_FALLBACK;
}
