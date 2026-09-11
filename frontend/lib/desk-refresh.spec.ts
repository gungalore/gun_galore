// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeskFetchError,
  clearDeskToken,
  deskFetch,
  isRecoveryOnlySession,
  refreshDeskSession,
  setDeskSession,
} from './desk-auth';

/**
 * THE DESK — the silent refresh, and the two ways it can go wrong quietly.
 *
 * 🚨 THE ACCESS TOKEN IS FIFTEEN MINUTES AND NOTHING RENEWED IT. Every 401 was
 * read as "signed out": the session was cleared and the operator was thrown to
 * the sign-in screen — roughly four times an hour, mid-task — while a
 * thirty-day refresh cookie sat untouched in the browser.
 *
 * 🚨 AND THE OBVIOUS FIX HAS ITS OWN FAILURE MODE. Each board fires several
 * parallel reads, so when the token dies they all 401 within milliseconds and
 * a naive refresh-on-401 rotates the session once per read.
 *
 * ⚠️ WHAT THAT ACTUALLY RISKS, STATED NARROWLY: rotate() keeps a THIRTY-SECOND
 * grace on the previous hash, so simultaneous rotations inside it are
 * tolerated and the losers are handed back the token they presented with
 * `rotated: false`. It is not an instant sign-out. The exposure is that all of
 * them write one shared httpOnly cookie, and a presenter arriving after the
 * grace lapses matches `prevRefreshHash` — which rotate() treats as a REPLAYED
 * credential and answers by revoking the session outright. Single-flight means
 * our own traffic never depends on that window. The first test here is what
 * keeps it single.
 *
 * ⚠️ jsdom, BECAUSE THE SESSION LIVES IN localStorage and the sign-out path
 * touches window.location. The node default has neither.
 */

/** A JWT whose payload decodes — only `exp` and `amr` are ever read. */
function tokenWith(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `head.${body}.sig`;
}

const LIVE = tokenWith({ exp: Math.floor(Date.now() / 1000) + 900, sid: 'sess_1' });
const FRESH = tokenWith({ exp: Math.floor(Date.now() / 1000) + 900, sid: 'sess_2' });

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    text: async () => JSON.stringify(body),
  };
}

/** Drain every pending microtask chain, including the ones a mock started. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Deferred so a test can hold the refresh open while more 401s arrive — which
 * is the only arrangement in which the race this file is about can happen at
 * all. A refresh that resolves before the second caller asks would pass a
 * single-flight test that does not actually single-flight.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.localStorage.clear();
  // window.location.href = … is a navigation jsdom refuses to perform; it
  // logs "Not implemented" and carries on, which is noisy but harmless. The
  // sign-out path is asserted through what it CLEARS, not where it goes.
  setDeskSession({ token: LIVE, recoveryOnly: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDeskToken();
});

describe('one refresh, however many requests hit 401 together', () => {
  it('answers four concurrent 401s with a single refresh and retries each once', async () => {
    const gate = deferred<void>();
    const calls: string[] = [];

    const spy = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith('/admin/auth/refresh')) {
        await gate.promise;
        return jsonResponse(200, { token: FRESH, recoveryOnly: false });
      }
      // Every board read 401s until the refresh has landed.
      const alreadyRefreshed = calls.some((c) => c.endsWith('/admin/auth/refresh'));
      return alreadyRefreshed
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, { message: 'Unauthorized' });
    });
    vi.stubGlobal('fetch', spy);

    const reads = Promise.all([
      deskFetch('/admin/desk/cards'),
      deskFetch('/admin/desk/ribbon'),
      deskFetch('/admin/alerts'),
      deskFetch('/admin/settings'),
    ]);

    // ⚠️ A FULL DRAIN, NOT ONE TICK. All four have to have hit their 401 and
    // queued behind the SAME in-flight promise before it resolves — if the
    // fourth arrives after the refresh has settled it legitimately starts a
    // second one, and the test would fail over its own timing rather than
    // over the behaviour.
    await flush();
    gate.resolve();
    await reads;

    const refreshes = calls.filter((c) => c.endsWith('/admin/auth/refresh'));
    expect(refreshes).toHaveLength(1);

    // Four first attempts + one refresh + four retries.
    expect(spy).toHaveBeenCalledTimes(9);
    expect(window.localStorage.getItem('gg_admin_token')).toBe(FRESH);
  });

  it('retries the original request ONCE, with the new token, and returns its body', async () => {
    const seen: (string | null)[] = [];
    const spy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/admin/auth/refresh')) {
        return jsonResponse(200, { token: FRESH, recoveryOnly: false });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      seen.push(auth);
      return seen.length === 1
        ? jsonResponse(401, { message: 'Unauthorized' })
        : jsonResponse(200, { cards: 3 });
    });
    vi.stubGlobal('fetch', spy);

    await expect(deskFetch('/admin/desk/cards')).resolves.toEqual({ cards: 3 });
    expect(seen).toEqual([`Bearer ${LIVE}`, `Bearer ${FRESH}`]);
  });

  it('does not loop when the retry is refused too, and does not sign out either', async () => {
    const spy = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/admin/auth/refresh')
        ? jsonResponse(200, { token: FRESH, recoveryOnly: false })
        : jsonResponse(401, { message: 'Unauthorized' }),
    );
    vi.stubGlobal('fetch', spy);

    await expect(deskFetch('/admin/desk/cards')).rejects.toBeInstanceOf(DeskFetchError);

    // Attempt, refresh, retry. A fourth call would be a second refresh, which
    // is the loop this structure exists to make impossible.
    expect(spy).toHaveBeenCalledTimes(3);

    // 🚨 AND THE SESSION SURVIVES. This assertion used to read
    // `toBeNull()` — it pinned a sign-out here, and that was the bug: the
    // refresh SUCCEEDED, which is the server saying this session is alive, so
    // a 401 on a token minted milliseconds ago cannot be about the
    // credential. Reading it as one ejected the operator on every business
    // refusal the backend answers with 401 — a mistyped authenticator code
    // among them. Whatever this route is refusing, it is not the session.
    expect(window.localStorage.getItem('gg_admin_token')).toBe(FRESH);
  });
});

describe('what a refresh answer means', () => {
  it('treats HTTP 200 {ok:false} as signed out, not as a token of undefined', async () => {
    // ⚠️ THE CONTROLLER REALLY DOES ANSWER 200 HERE. With neither cookie nor
    // body carrying a refresh token it clears the cookies and returns
    // `{ok:false}` with no `token` key at all. A client that destructures
    // `token` writes `undefined` into localStorage and then loops: a value is
    // present, so it renders, so the API 401s, so it refreshes.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: false })));

    await expect(refreshDeskSession()).resolves.toEqual({ kind: 'signed-out' });
    expect(window.localStorage.getItem('gg_admin_token')).toBe(LIVE);
  });

  it('keeps the session when the server cannot be reached', async () => {
    // ⚠️ A DROPPED CONNECTION IS NOT A SIGN-OUT. Folding the two together
    // means a flaky link costs a password for a session the server still
    // considers live.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(refreshDeskSession()).resolves.toEqual({ kind: 'unreachable' });
    expect(window.localStorage.getItem('gg_admin_token')).toBe(LIVE);
  });

  it('does not read a 429 as the end of the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { message: 'Too many' })));
    await expect(refreshDeskSession()).resolves.toEqual({ kind: 'unreachable' });
    expect(window.localStorage.getItem('gg_admin_token')).toBe(LIVE);
  });

  it('a 401 from refresh itself clears the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'nope' })));
    await expect(refreshDeskSession()).resolves.toEqual({ kind: 'signed-out' });
  });

  it('carries recoveryOnly out of the refresh body, where it is the only copy', async () => {
    // It is not a JWT claim and /admin/auth/me does not return it, so a
    // refresh that dropped it would silently unbanner a read-only session.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { token: FRESH, recoveryOnly: true })),
    );

    await refreshDeskSession();
    expect(isRecoveryOnlySession()).toBe(true);
  });

  it('sends the cookie — without credentials the refresh cookie never leaves the browser in dev', async () => {
    // gg_admin_rt is httpOnly and path-scoped to /api/admin/auth. Production
    // is same-origin behind nginx; local dev points NEXT_PUBLIC_API_URL at
    // :3001, which is cross-origin, so omitting this fails in dev only.
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { token: FRESH, recoveryOnly: false }),
    );
    vi.stubGlobal('fetch', spy);

    await refreshDeskSession();
    expect(spy.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });
});

describe('a 401 that is a verdict on what was typed, not on the session', () => {
  /**
   * 🚨 A MISTYPED SIX-DIGIT CODE USED TO SIGN THE OPERATOR OUT OF THE DESK.
   *
   * authedFetch read every 401 as a dead access token. But the backend answers
   * several BUSINESS refusals with 401, because 401 is the honest code for
   * them — confirmTotp on a code that did not match, enrolTotp and
   * changePassword on a wrong current password. So one wrong digit in the
   * Confirm box cleared the session and navigated to the sign-in screen, and
   * the drawer's error strip never rendered because the browser was already
   * leaving. On the recovery path that is the whole 2am failure: a recovery
   * code was spent to get in, a typo ejects them, and getting back in costs a
   * second one — out of ten that cannot be re-read.
   */
  it('shows the server sentence and KEEPS the session, on the first attempt', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return jsonResponse(401, {
          statusCode: 401,
          message:
            'That code did not match. Check your phone’s clock is set automatically, then try the next code.',
        });
      }),
    );

    const err = await deskFetch('/admin/auth/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ totpCode: '000000' }),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DeskFetchError);
    expect((err as DeskFetchError).message).toContain('did not match');

    // The session is untouched: still signed in, still on the same token.
    expect(window.localStorage.getItem('gg_admin_token')).toBe(LIVE);

    // ⚠️ AND IT WAS ASKED EXACTLY ONCE. A refresh here would replay the
    // request, sending the wrong code to the server a second time and
    // spending one rotation of a thirty-day refresh token to learn the same
    // answer twice.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.endsWith('/admin/auth/refresh'))).toBe(false);
  });

  it('also keeps the session when the 401 arrives on a token minted seconds ago', async () => {
    // The other half: a route NOT on the opt-out list, whose access token had
    // genuinely expired. The refresh succeeds — which is the server saying
    // this session is alive — so a 401 on the retry cannot be the credential,
    // and must not be read as one.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        calls.push(path);
        if (path.endsWith('/admin/auth/refresh')) {
          return jsonResponse(200, { token: FRESH, recoveryOnly: false });
        }
        return jsonResponse(401, { statusCode: 401, message: 'Not allowed to do that.' });
      }),
    );

    const err = await deskFetch('/admin/users/u1/kyc-review', {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DeskFetchError);
    expect((err as DeskFetchError).message).toBe('Not allowed to do that.');
    expect(window.localStorage.getItem('gg_admin_token')).toBe(FRESH);
    expect(calls.filter((c) => c.endsWith('/admin/auth/refresh'))).toHaveLength(1);
  });
});
