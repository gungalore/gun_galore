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
 *
 * 🚨 THE ACCESS TOKEN IS FIFTEEN MINUTES, NOT EIGHT HOURS (backend commits
 * bc16883c / d0eb7d43). Before the refresh machinery below, a 401 meant
 * "signed out" — so the Desk ejected the operator to the sign-in screen
 * roughly four times an hour, mid-task, and a half-typed reject reason went
 * with it. The refresh cookie behind that is THIRTY DAYS, so almost every one
 * of those ejections was avoidable.
 */

const STORAGE_KEY = 'gg_admin_token';

/**
 * Whether this session was opened with a RECOVERY CODE rather than the
 * authenticator.
 *
 * ⚠️ IT IS STORED BECAUSE IT ARRIVES NOWHERE ELSE. `recoveryOnly` comes back
 * in the login and refresh response bodies and in NOTHING else — it is not a
 * JWT claim and `GET /admin/auth/me` does not return it. A banner that has to
 * survive a reload therefore has to persist it here or re-derive it from
 * `GET /admin/auth/sessions` matched against the token's own `sid`.
 */
const RECOVERY_KEY = 'gg_admin_recovery_only';

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

/** The three auth routes this file talks to itself. */
const REFRESH_PATH = '/admin/auth/refresh';
const LOGOUT_PATH = '/admin/auth/logout';

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function decodeExp(token: string): number | null {
  const exp = decodeClaims(token)?.exp;
  return typeof exp === 'number' ? exp : null;
}

/* ── The session, and who is watching it ──────────────────────────────── */

/**
 * Listeners for "the session changed".
 *
 * The recovery-only banner has to appear the moment a refresh tells us the
 * session is read-only, and disappear the moment a fresh sign-in says it is
 * not. localStorage fires no event in the tab that wrote it, so without this
 * the banner would be correct only on a reload.
 */
const watchers = new Set<() => void>();

function announce(): void {
  for (const fn of watchers) fn();
}

export function subscribeDeskSession(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

export function setDeskToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token);
  announce();
}

/**
 * Store what a login or a refresh just handed back.
 *
 * ⚠️ BOTH HALVES, IN ONE CALL. `recoveryOnly` written separately from the
 * token is `recoveryOnly` that goes stale the first time one write lands
 * without the other — and the stale direction that matters is a read-only
 * session whose banner has been cleared, which reads as the Desk being broken
 * when every write comes back 403.
 */
export function setDeskSession(session: { token: string; recoveryOnly: boolean }): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, session.token);
  if (session.recoveryOnly) window.localStorage.setItem(RECOVERY_KEY, '1');
  else window.localStorage.removeItem(RECOVERY_KEY);
  announce();
}

/**
 * Is this session the read-only kind?
 *
 * The stored flag is the answer, and the token is a NARROW second opinion:
 * `amr` containing 'recovery' means recoveryOnly, so a session restored from
 * a tab that never saw the login response still shows the banner.
 *
 * ⚠️ THE CONVERSE DOES NOT HOLD, so do not invert this. admin-auth.service.ts
 * issues `recoveryOnly: true` with `amr: ['pwd']` when ADMIN_TOTP_REQUIRED is
 * on and the admin has never enrolled — `amr` without 'recovery' therefore
 * proves nothing. That env var is unset today, which is the only reason the
 * gap is currently unreachable; the stored flag is what actually covers it.
 */
export function isRecoveryOnlySession(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.localStorage.getItem(RECOVERY_KEY) === '1') return true;
  const token = window.localStorage.getItem(STORAGE_KEY);
  if (!token) return false;
  const amr = decodeClaims(token)?.amr;
  return Array.isArray(amr) && amr.includes('recovery');
}

/**
 * Drop only the ACCESS token, keeping the session.
 *
 * ⚠️ NOT clearDeskToken(). An expired access token is the ordinary resting
 * state of a fifteen-minute credential sitting behind a thirty-day refresh
 * cookie — it is not a sign-out, and treating it as one would clear the
 * recovery-only flag and flash the banner off and on around every refresh.
 */
function dropAccessToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  announce();
}

export function getDeskToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(STORAGE_KEY);
  if (!token) return null;
  const exp = decodeExp(token);
  if (exp !== null && exp * 1000 <= Date.now()) {
    dropAccessToken();
    return null;
  }
  return token;
}

/**
 * Clear every trace of the session on this device.
 *
 * ⚠️ BOTH STORES, ALWAYS. Clearing one and not the other is the original
 * bug wearing a different hat: whichever survives is a live credential.
 *
 * ⚠️ IT CANNOT TOUCH `gg_admin_rt`. The refresh cookie is httpOnly, so only
 * the server can drop it — which is why signOutOfDesk() below posts to
 * /admin/auth/logout instead of only clearing what JavaScript can see.
 */
export function clearDeskToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(RECOVERY_KEY);
  document.cookie = `${LEGACY_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  announce();
}

/**
 * Sign out and land on the sign-in screen. The only honest logout.
 *
 * 🚨 IT NOW REVOKES THE SERVER-SIDE SESSION TOO. Clearing localStorage ends
 * the access token this browser holds and does nothing at all to the
 * thirty-day refresh session behind it — so "sign out" on a shared laptop
 * left a credential the next person's browser would happily rotate into a
 * fresh admin session.
 *
 * ⚠️ keepalive, AND NO await. The redirect on the next line tears the page
 * down; a plain fetch would be cancelled with the request half-sent. Nothing
 * is gated on the answer — a failed revoke must not keep somebody signed in
 * on the screen in front of them.
 */
/**
 * Ask the server to revoke the session behind the refresh cookie.
 *
 * ⚠️ THIS IS THE ONLY HALF THAT CAN REACH gg_admin_rt. The cookie is
 * httpOnly and path-scoped to /api/admin/auth, so no amount of
 * `document.cookie` from here touches it — only the server clearing it
 * does. Fire-and-forget with keepalive, because a revoke lost to a dead
 * connection must not keep somebody signed in on the screen in front of
 * them; the cost of that choice is that such a revoke is silent.
 *
 * Unguarded on purpose (see the logout route): you must be able to sign out
 * holding a dead access token, and the refresh token presented IS the proof
 * of what to revoke.
 */
function revokeServerSession(): void {
  if (typeof window === 'undefined') return;
  void fetch(`${DESK_API_URL}${LOGOUT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    keepalive: true,
    body: '{}',
  }).catch(() => undefined);
}

export function signOutOfDesk(): void {
  revokeServerSession();
  clearDeskToken();
  if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
}

/**
 * Call from the sign-in screen on mount.
 *
 * Someone arriving at the login page is either signed out or trying to be;
 * either way a token still sitting in storage is not something to keep.
 *
 * 🚨 IT REVOKES SERVER-SIDE TOO, AND IT HAS TO. Clearing localStorage alone
 * left the THIRTY-DAY httpOnly refresh cookie untouched, so "signing out" by
 * visiting the front door was cosmetic: RequireDeskSession refreshes before
 * it gives up, so pressing Back — or typing /admin/desk — redeemed the still
 * live cookie into a fresh fifteen-minute token and rendered the boards, with
 * no password. Signing out and handing somebody the laptop therefore handed
 * them an admin session, which is the exact failure the header of this file
 * exists to warn about.
 *
 * ⚠️ AND THAT MEANS ARRIVING HERE ENDS A LIVE SESSION IN EVERY TAB, because
 * they share one cookie. That is the intent — "arriving at the front door
 * means the previous session is over" — and it is the safe direction: the
 * cost of being wrong is retyping a password, against handing over an admin
 * panel.
 */
export function clearLingeringSession(): void {
  revokeServerSession();
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

/* ── Silent refresh ───────────────────────────────────────────────────── */

/**
 * What a refresh attempt actually told us.
 *
 * ⚠️ THREE OUTCOMES, NOT TWO, AND THE THIRD IS THE ONE THAT MATTERS. Folding
 * "the server refused this session" together with "the server did not answer"
 * means a dropped connection signs the operator out and makes them type a
 * password — for a session the server still considers live. Only `signed-out`
 * clears anything.
 */
export type DeskRefreshOutcome =
  | { kind: 'renewed'; token: string }
  | { kind: 'signed-out' }
  | { kind: 'unreachable' };

/**
 * The ONE refresh in flight, shared by every caller that asks while it runs.
 *
 * 🚨 SINGLE-FLIGHT IS NOT AN OPTIMISATION HERE. Each board fires several
 * parallel reads; when the access token dies they all 401 within a few
 * milliseconds of each other, and without this each one rotates the session
 * independently.
 *
 * ⚠️ BE PRECISE ABOUT WHAT THAT COSTS, because the server does have a
 * defence and overstating it is how somebody later decides the defence makes
 * this unnecessary. AdminSessionService.rotate() keeps a THIRTY-SECOND grace
 * window on the previous hash, so simultaneous rotations inside it are
 * tolerated — the losers get the token they presented back with
 * `rotated: false`. What single-flight removes is the dependence on landing
 * inside that window at all: every parallel rotation writes the same shared
 * httpOnly cookie, and a presenter that arrives after the grace has lapsed
 * matches `prevRefreshHash` instead, which rotate() treats as a replayed —
 * i.e. stolen — credential and answers by REVOKING THE SESSION. One refresh
 * per dead token means that branch is never reached by our own traffic.
 */
let refreshInFlight: Promise<DeskRefreshOutcome> | null = null;

async function requestRefresh(): Promise<DeskRefreshOutcome> {
  let res: Response;
  try {
    res = await fetch(`${DESK_API_URL}${REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // ⚠️ REQUIRED IN DEV, HARMLESS IN PRODUCTION. `gg_admin_rt` is
      // path-scoped to /api/admin/auth and httpOnly. In production nginx
      // proxies /api/ so the Desk is same-origin and fetch's default
      // credentials would carry it; locally NEXT_PUBLIC_API_URL points at
      // :3001, which is cross-origin, and without this the cookie is never
      // sent and every refresh in dev falls through to a body fallback we do
      // not have. Failing in dev only is the worse place to find out.
      credentials: 'include',
      cache: 'no-store',
      // The refresh token itself is never in JS — it is the cookie above.
      // The body exists because AdminRefreshDto accepts an optional
      // refreshToken and an empty object validates.
      body: '{}',
    });
  } catch {
    return { kind: 'unreachable' };
  }

  // 401 is the server saying this session is over. Anything else non-ok is a
  // throttle or a bad gateway and says nothing about the session — treating a
  // 429 as a sign-out would eject an operator for reloading too fast.
  if (res.status === 401) return { kind: 'signed-out' };
  if (!res.ok) return { kind: 'unreachable' };

  let json: { token?: unknown; recoveryOnly?: unknown } | null = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    return { kind: 'unreachable' };
  }

  // ⚠️ A 200 WITH NO `token` IS A REAL SIGN-OUT. When neither the cookie nor
  // the body carries a refresh token the controller clears the cookies and
  // answers HTTP 200 `{ok:false}` — no `token` key at all. A client that
  // destructures `token` and stores it writes `undefined` into localStorage
  // and then loops: a value is present, so it renders, so the API 401s, so it
  // refreshes.
  const token = typeof json?.token === 'string' ? json.token : null;
  if (!token) return { kind: 'signed-out' };

  // ⚠️ `rotated` IS NOT ON THE WIRE, so nothing here branches on it. The
  // controller consumes it internally to decide whether to re-write the
  // cookie inside the 30-second grace window; from here the cookie is
  // authoritative and invisible either way. Store the access token, leave the
  // cookie alone.
  setDeskSession({ token, recoveryOnly: json?.recoveryOnly === true });
  return { kind: 'renewed', token };
}

export function refreshDeskSession(): Promise<DeskRefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  const flight: Promise<DeskRefreshOutcome> = requestRefresh()
    .catch((): DeskRefreshOutcome => ({ kind: 'unreachable' }))
    .finally(() => {
      // Only clear our own flight — a later refresh may already have replaced
      // it, and nulling that one would let the next 401 start a second.
      if (refreshInFlight === flight) refreshInFlight = null;
    });
  refreshInFlight = flight;
  return flight;
}

/* ── The authenticated request ────────────────────────────────────────── */

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

function signedOut(path: string): DeskFetchError {
  clearDeskToken();
  if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
  return new DeskFetchError('Signed out', 401, '', path);
}

function sendOnce(path: string, init: RequestInit): Promise<Response> {
  const token = getDeskToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${DESK_API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

/**
 * One authenticated request, with at most ONE retry behind a refresh.
 *
 * ⚠️ ONCE, AND COUNTED BY STRUCTURE RATHER THAN BY A COUNTER. A loop that
 * refreshes on every 401 turns a genuinely revoked session into an infinite
 * pair of requests; there is exactly one retry here because there is exactly
 * one second `sendOnce` call.
 *
 * ⚠️ `init` IS REPLAYED AS-IS, so a body must be a string (every Desk write
 * sends JSON.stringify). A ReadableStream body would be consumed by the first
 * attempt and the retry would throw — nothing sends one today.
 */
/**
 * Routes whose 401 is a VERDICT ON WHAT WAS TYPED, never on the session.
 *
 * ⚠️ THEY OPT OUT OF THE REFRESH DANCE, AND NOT ONLY AS AN OPTIMISATION. A
 * refresh on a business refusal replays the request — so a wrong TOTP code is
 * sent to the server TWICE, and every mistype spends one rotation of a
 * thirty-day refresh token for nothing. The retry is there to survive an
 * expired access token; these refusals have nothing to do with the token.
 *
 * ⚠️ MATCHED ON SUFFIX, so a future `/admin/auth/password` or a versioned
 * prefix still lands. Keep it to routes where the server is judging a typed
 * secret; a route added here by mistake stops recovering from an ordinary
 * expiry, which is a worse failure than the one this avoids.
 */
const REFUSES_ON_INPUT_NOT_SESSION = [
  '/admin/auth/totp/confirm',
  '/admin/auth/totp/enrol',
  '/admin/auth/password',
];

/**
 * The server's own sentence and the body it came from, read ONCE.
 *
 * ⚠️ ONE read(), NOT TWO. A Response body is a stream and can only be
 * consumed once; calling .text() twice on the same Response throws
 * "body stream already read", which would turn a wrong-code message into an
 * unhandled error on the one path whose job is to explain what went wrong.
 */
async function refusal(res: Response): Promise<{ message: string; body: string }> {
  const body = await res.text().catch(() => '');
  return {
    message:
      messageInBody(body) ?? 'That was not accepted. Check what you typed and try again.',
    body,
  };
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  const first = await sendOnce(path, init);
  if (first.status !== 401) return first;

  // See REFUSES_ON_INPUT_NOT_SESSION: refreshing here would re-send what the
  // operator typed and burn a rotation to learn the same answer twice.
  if (REFUSES_ON_INPUT_NOT_SESSION.some((r) => path.startsWith(r))) {
    const { message, body } = await refusal(first);
    throw new DeskFetchError(message, 401, body, path);
  }

  const outcome = await refreshDeskSession();

  if (outcome.kind === 'renewed') {
    const second = await sendOnce(path, init);
    // 🚨 A 401 ON A BRAND-NEW TOKEN IS A BUSINESS REFUSAL, NOT A DEAD SESSION,
    // AND READING IT AS ONE EJECTED THE OPERATOR MID-ENROLMENT.
    //
    // The refresh above SUCCEEDED, which is the server telling us this session
    // is alive; the token the retry carried was minted seconds ago. So
    // whatever the route is refusing, it is not the credential. This branch
    // used to reason exactly that far — "a brand-new access token was
    // rejected, so the credential is not what is wrong" — and then signed the
    // operator out anyway.
    //
    // The backend answers several BUSINESS refusals with 401, because 401 is
    // the honest code for them: confirmTotp on a code that did not match,
    // enrolTotp and changePassword on a wrong current password. So one
    // mistyped digit in the Confirm box cleared the session and threw the
    // operator to the sign-in screen with no message — the drawer's own error
    // strip never rendered, because the browser was already navigating away.
    // On the recovery path that is the whole 2am failure: they spent a
    // recovery code to get in, a typo ejects them, and getting back in costs
    // a second one. It also strands the staged totpPendingSecret.
    //
    // Surfaced as a normal DeskFetchError so the caller can show the server's
    // sentence — that sentence is the entire value of these refusals ("check
    // your phone's clock is set automatically").
    if (second.status === 401) {
      const { message, body } = await refusal(second);
      throw new DeskFetchError(message, 401, body, path);
    }
    return second;
  }

  if (outcome.kind === 'unreachable') {
    // ⚠️ THE SESSION IS KEPT. We do not know that it is over — we know we
    // could not ask. Clearing here would make a flaky connection cost a
    // password. The surface shows this sentence in its FailedRegion and the
    // operator can retry.
    throw new DeskFetchError(
      'Could not reach the server to renew this session. Check the connection and try again.',
      401,
      '',
      path,
    );
  }

  throw signedOut(path);
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
 * A 401 goes through the refresh above before anything is cleared. Every
 * other failure throws a DeskFetchError carrying the status and the server's
 * own words, because the surfaces render those verbatim rather than inventing
 * a friendly sentence.
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
 * ⚠️ IT SHARES authedFetch, AND THAT IS THE POINT NOW. It used to repeat the
 * 401 handling by hand, which meant a CSV export could 401 on a fifteen-
 * minute-old token and eject the operator while every ordinary read quietly
 * refreshed — and a download that silently 401s reads as the browser blocking
 * it, not as a session problem.
 */
export async function deskFetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await authedFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DeskFetchError(`${res.status} ${res.statusText}`, res.status, body, path);
  }
  return res;
}

export async function deskFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init);

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

/**
 * The server's OWN SENTENCE for a refusal, for a control that has room for
 * one line and not for a transcript.
 *
 * 🚨 `DeskFetchError.message` IS "400 Bad Request" AND NOTHING ELSE. Several
 * surfaces render `err.message` under a comment promising they show the
 * server's words; they show the status line. Nest puts the real sentence in
 * the JSON body — `message`, which class-validator makes an ARRAY when more
 * than one rule failed — so a validator message like "Say why this account is
 * being granted admin access." never reached the operator at all.
 */
export function deskServerMessage(err: unknown): string | null {
  if (!(err instanceof DeskFetchError)) return null;
  return messageInBody(err.body);
}

/**
 * The server's sentence out of a RAW response body.
 *
 * ⚠️ SPLIT OUT OF deskServerMessage BECAUSE THAT ONE TAKES AN ERROR, AND A
 * CALLER HOLDING A BODY STRING GOT null FOR EVERY INPUT. Nest sends
 * `{statusCode, message}` where message is a string, or an ARRAY of strings
 * when class-validator refused — both are the sentence the Desk renders
 * verbatim, because a hand-written "something went wrong" loses the only part
 * the operator can act on ("check your phone's clock is set automatically").
 */
export function messageInBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    const m = parsed?.message;
    if (typeof m === 'string' && m.trim()) return m;
    if (Array.isArray(m)) {
      const lines = m.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      if (lines.length) return lines.join(' ');
    }
  } catch {
    // Not JSON — a proxy's HTML error page, say. The body is not a sentence.
  }
  return null;
}
