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
 *   - 30-day lifetime is set client-side; server still issues 8h JWTs
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
 */
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
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
