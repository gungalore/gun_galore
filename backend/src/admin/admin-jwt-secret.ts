/**
 * Single source of truth for the admin JWT secret.
 *
 * Replaces the previously-duplicated `process.env.JWT_ADMIN_SECRET ||
 * 'dev-admin-secret-change-in-prod'` fallback that lived in four files.
 * That fallback meant: if JWT_ADMIN_SECRET were ever unset/empty in
 * production, the app would silently sign AND verify admin sessions with
 * a string committed to the repo — i.e. anyone could forge a SUPERADMIN
 * token and own every /admin route. No more.
 *
 * In production: a missing / empty / known-default secret THROWS, so the
 * admin auth surface fails closed (and main.ts asserts the same at
 * bootstrap for a clean, obvious startup failure).
 *
 * In development: a fixed throwaway keeps local admin login working with
 * zero per-developer config. It is explicitly NOT usable in production.
 */
const KNOWN_BAD = 'dev-admin-secret-change-in-prod';
const DEV_FALLBACK = 'dev-only-admin-secret-NOT-for-production';

export function adminJwtSecret(): string {
  const s = process.env.JWT_ADMIN_SECRET;
  if (s && s.trim().length > 0 && s !== KNOWN_BAD) {
    return s;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_ADMIN_SECRET must be set to a strong, non-default value in production. ' +
        'Refusing to start with a missing/empty/default admin secret.',
    );
  }
  return DEV_FALLBACK;
}
