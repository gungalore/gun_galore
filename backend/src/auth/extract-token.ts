import { Request } from 'express';

/**
 * The access-token cookie. Set by the auth controller, sent automatically by
 * the browser because the API is same-origin with the site (nginx proxies
 * alloutdoor.co.za/api/ to :3001).
 */
export const ACCESS_COOKIE = 'ao_at';

/**
 * The refresh-token cookie. Scoped to /api/auth so it is never sent on an
 * ordinary API call — the only routes that need it are refresh and logout.
 */
export const REFRESH_COOKIE = 'ao_rt';

/**
 * Every guard extracts the caller's access token through this one function.
 *
 * Two transports, in this order:
 *
 *   1. `Authorization: Bearer <jwt>` — used by the Capacitor app shells and by
 *      Next Server Components, which forward the cookie they read with
 *      `cookies()` as a header (a server-to-server fetch carries no cookie jar).
 *   2. The `ao_at` cookie — the browser path.
 *
 * ⚠️ The bearer branch is not a legacy leftover. `capacitor://localhost` and
 * `ionic://localhost` are cross-SITE, so a `SameSite=Lax` cookie is never sent
 * from the app shells. Removing it signs every app user out permanently.
 */
export function extractAccessToken(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  if (type === 'Bearer' && token) return token;

  const cookies = (request as Request & { cookies?: Record<string, string> })
    .cookies;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  return undefined;
}

export function extractRefreshToken(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> })
    .cookies;
  const fromCookie = cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  // App shells have no cookie jar for our origin, so they hand the refresh
  // token back in the body instead. Read by the controller, not here.
  return undefined;
}
