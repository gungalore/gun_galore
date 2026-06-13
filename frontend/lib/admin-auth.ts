/**
 * Client-side admin auth helper.
 *
 * The cookie-based admin auth was blocked in some browsers by privacy
 * extensions / strict cookie policies / Cloudflare CORS interaction
 * that we never fully pinned down. Rather than fight every browser
 * config, this helper switches admin auth to localStorage + bearer
 * tokens — bulletproof across every browser.
 *
 * Trade-offs vs cookies:
 *   - localStorage is JS-readable (XSS risk) but our admin surface is
 *     a tightly-controlled internal tool, not user-facing, so XSS
 *     exposure is minimal
 *   - Middleware can't gate admin pages anymore (server can't read
 *     localStorage); each admin page must do its own client-side gate
 *   - Client lifetime is aligned with the server's 8h JWT: we decode
 *     the exp claim on every read and clear stale tokens locally so a
 *     dead JWT never reaches the API. Server JWT is still the source
 *     of truth.
 *
 * Usage in a client component admin page:
 *
 *   'use client';
 *   import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
 *
 *   export default function MyAdminPage() {
 *     useEffect(() => { requireAdminToken(); }, []);
 *     const [data, setData] = useState(null);
 *     useEffect(() => {
 *       adminFetch('/admin/something').then(r => r.json()).then(setData);
 *     }, []);
 *     // ...
 *   }
 */

const STORAGE_KEY = 'gg_admin_token';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Pull the exp claim out of a JWT payload without verifying signature
// (the server is the one that verifies; we just need to know when to
// stop sending a token we already know is dead).
function getTokenExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '==='.slice((payload.length + 3) % 4);
    const json = JSON.parse(atob(padded));
    if (typeof json.exp !== 'number') return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const expMs = getTokenExpiryMs(token);
  if (expMs === null) return false;
  return Date.now() >= expMs;
}

/**
 * Save the admin JWT after a successful /admin/auth/login.
 */
export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage quota exceeded or disabled — silently skip.
  }
}

/**
 * Read the stored admin JWT, or null if missing / not in browser.
 * Returns null and clears the entry if the JWT's exp has passed —
 * matches the server's 8h lifetime so we never ship a dead token.
 */
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return null;
    if (isTokenExpired(token)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Wipe the admin JWT (call on logout).
 */
export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Hard-redirect to /admin/login if there's no stored admin JWT.
 * Call in a useEffect at the top of every admin page.
 * Returns true when a token exists, false when it just kicked off
 * the redirect (caller should bail / render nothing).
 */
export function requireAdminToken(): boolean {
  if (typeof window === 'undefined') return false;
  const token = getAdminToken();
  if (!token) {
    window.location.href = '/admin/login';
    return false;
  }
  return true;
}

/**
 * fetch() wrapper that automatically:
 *   - prefixes API_URL
 *   - adds Authorization: Bearer <token>
 *   - on 401, clears the token and redirects to login
 *
 * Returns the raw Response so the caller can decide how to parse.
 * Caller is responsible for checking res.ok and handling other errors.
 */
export async function adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    // Token rejected (expired or revoked) — wipe it and bounce.
    clearAdminToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/admin/login';
    }
  }

  return res;
}
