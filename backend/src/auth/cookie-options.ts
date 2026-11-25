import { CookieOptions } from 'express';

/**
 * The shared cookie base for every session-ish cookie this app sets.
 *
 * `secure` must follow the scheme, not be hardcoded true: a Secure cookie is
 * silently dropped by the browser over plain http, so hardcoding it makes
 * local development look like a broken login with nothing in any log.
 * Production is https end to end (nginx sends X-Forwarded-Proto https).
 *
 * Extracted from `auth.controller.ts` when the catalogue declaration cookie
 * landed, so the two can never drift apart on the attributes that matter
 * (HttpOnly, SameSite) — a declaration that lost HttpOnly or SameSite would
 * be re-sent by things we did not intend to send it to.
 */
export const isProdCookie = (): boolean => process.env.NODE_ENV === 'production';

export const sessionCookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: isProdCookie(),
  sameSite: 'lax',
});
