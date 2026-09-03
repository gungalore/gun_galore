/**
 * THE DESK — admin authentication.
 *
 * A deliberate replacement for lib/admin-auth.ts rather than an import of it,
 * because the old one has a hole this one exists to close.
 *
 * ⚠️ THE BUG THIS FIXES. In the legacy panel `clearAdminToken()` has exactly
 * one call site in the entire repo — inside `adminFetch`'s own 401 branch.
 * "Log out" is a plain link to /admin/logout, which drops the secondary
 * cookie and leaves the real credential, the JWT in localStorage, exactly
 * where it was. Signing out and handing someone the laptop therefore hands
 * them an admin session. Here, sign-out is a function, it clears both, and
 * the sign-in screen clears anything lingering on mount so a half-dead
 * session cannot survive a visit to the login page either.
 *
 * The server remains the only real verifier. The expiry check below exists
 * to avoid sending a token we already know is dead, not to decide anything:
 * a token revoked server-side but not yet expired still passes it, and is
 * caught by the first 401.
 */

const STORAGE_KEY = 'gg_admin_token';

/** The legacy cookie the old login screen also set, for server components. */
const LEGACY_COOKIE = 'gg_admin_sess';

/**
 * ⚠️ ONE SOURCE FOR THE API BASE. The legacy panel defines this constant
 * twice — once in lib/admin-auth.ts and once in the login page — and they
 * agree today only because INTERNAL_API_URL happens to be unset. The day it
 * is set, the login screen would post to one host and every subsequent fetch
 * would go to another, and the symptom would be "login works, nothing loads".
 */
export const DESK_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export const DESK_SIGN_IN_PATH = '/admin/login';

function decodeExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

export function setDeskToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function getDeskToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(STORAGE_KEY);
  if (!token) return null;
  const exp = decodeExp(token);
  if (exp !== null && exp * 1000 <= Date.now()) {
    clearDeskToken();
    return null;
  }
  return token;
}

/**
 * Clear every trace of the session on this device.
 *
 * ⚠️ BOTH STORES, ALWAYS. Clearing one and not the other is the original
 * bug wearing a different hat: whichever survives is a live credential.
 */
export function clearDeskToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${LEGACY_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** Sign out and land on the sign-in screen. The only honest logout. */
export function signOutOfDesk(): void {
  clearDeskToken();
  if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
}

/**
 * Call from the sign-in screen on mount.
 *
 * Someone arriving at the login page is either signed out or trying to be;
 * either way a token still sitting in storage is not something to keep.
 */
export function clearLingeringSession(): void {
  clearDeskToken();
}

/** Page guard. Bounces to sign-in when there is no usable token. */
export function requireDeskToken(): string | null {
  const token = getDeskToken();
  if (!token && typeof window !== 'undefined') {
    window.location.href = DESK_SIGN_IN_PATH;
  }
  return token;
}

export class DeskFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'DeskFetchError';
  }
}

/**
 * Every call the Desk makes to the admin API.
 *
 * ⚠️ ALWAYS no-store. The Desk is a worklist: a cached pile is a card the
 * operator has already actioned, shown again, or one that arrived while they
 * were reading and is now invisible. The legacy panel sets no cache policy at
 * all and gets away with it only because browser heuristics happen to be
 * conservative on these responses.
 *
 * On 401 the session is cleared and the operator is sent to sign in — the
 * one behaviour worth keeping from the old lib. Every other failure throws a
 * DeskFetchError carrying the status and the server's own words, because the
 * surfaces render those verbatim rather than inventing a friendly sentence.
 */
/**
 * The same authenticated request, returning the RAW Response.
 *
 * ⚠️ FOR FILES, NOT FOR JSON — an export is bytes plus a Content-Disposition,
 * and deskFetch's job is to parse a body. Written as its own function rather
 * than a flag on deskFetch because the two differ in what they return, and a
 * boolean that changes a return type is how a caller ends up with a Response
 * where it expected a parsed object.
 *
 * ⚠️ IT REPEATS THE 401 HANDLING DELIBERATELY. Signing out on a stale token
 * has to happen for a download exactly as it does for a read; a file request
 * that quietly 401s would look like a browser blocking the download.
 */
export async function deskFetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getDeskToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${DESK_API_URL}${path}`, { ...init, headers, cache: 'no-store' });

  if (res.status === 401) {
    clearDeskToken();
    if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
    throw new DeskFetchError('Signed out', 401, '', path);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DeskFetchError(`${res.status} ${res.statusText}`, res.status, body, path);
  }
  return res;
}

export async function deskFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getDeskToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${DESK_API_URL}${path}`, { ...init, headers, cache: 'no-store' });

  if (res.status === 401) {
    clearDeskToken();
    if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
    throw new DeskFetchError('Signed out', 401, '', path);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DeskFetchError(`${res.status} ${res.statusText}`, res.status, body, path);
  }

  // 204 and friends: a successful action that returns nothing is normal here
  // (acknowledge, nudge), and JSON.parse('') throws.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * The failure text a FailedRegion shows: what we asked for, and what came
 * back, with nothing smoothed over.
 */
export function describeFailure(err: unknown): string {
  if (err instanceof DeskFetchError) {
    return `GET ${err.path}\n${err.message}${err.body ? `\n\n${err.body}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}
