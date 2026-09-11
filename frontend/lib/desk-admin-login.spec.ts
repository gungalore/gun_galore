// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInToDesk } from './desk-admin-login';
import { clearDeskToken, isRecoveryOnlySession } from './desk-auth';

/**
 * THE DESK — the sign-in step machine.
 *
 * 🚨 THE PAGE NEVER READ THE REFUSAL BODY, AND TOTP MADE THAT A LOCKOUT. An
 * enrolled admin who sends no code is refused with a 401 carrying
 * `code: 'TOTP_REQUIRED'` — meaning the password was RIGHT. The old screen
 * treated every non-429 refusal identically and printed "That email and
 * password do not match.", so the operator was told their correct password was
 * wrong, forever, with no code box on screen.
 *
 * ⚠️ THE SHAPES BELOW ARE READ OFF THE HANDLERS, not guessed:
 * admin-auth.service.ts refuses with the plain sentence "Email, password or
 * code is not right." and NO code field for a wrong password, a wrong TOTP
 * code and a spent recovery code alike — the `code` field appears on exactly
 * one refusal.
 */

function refusal(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function accepted(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** A token whose payload decodes; only exp and amr are ever read off it. */
const TOKEN = `head.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 }))}.sig`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDeskToken();
});

describe('step one — email and password', () => {
  it('asks for a code when the server says TOTP_REQUIRED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        refusal(401, {
          message: 'Enter the six-digit code from your authenticator app.',
          code: 'TOTP_REQUIRED',
        }),
      ),
    );

    await expect(signInToDesk({ email: 'op@example.com', password: 'hunter22two' })).resolves.toEqual(
      { kind: 'need-code' },
    );
  });

  it('says nothing about which half was wrong on an ordinary refusal', async () => {
    // Deliberately one message for a wrong password and an unknown address —
    // the admin roster is not a thing to let anyone enumerate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => refusal(401, { message: 'Email, password or code is not right.' })),
    );

    const out = await signInToDesk({ email: 'op@example.com', password: 'wrong' });
    expect(out).toEqual({ kind: 'refused', message: 'That email and password do not match.' });
  });

  it('reads a 429 as the throttler rather than as a bad password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => refusal(429, { message: 'Too many' })));
    const out = await signInToDesk({ email: 'op@example.com', password: 'x' });
    expect(out.kind).toBe('throttled');
  });

  it('does not claim a refusal when the server could not be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const out = await signInToDesk({ email: 'op@example.com', password: 'x' });
    expect(out.kind).toBe('unreachable');
  });

  it('sends credentials, or the refresh cookie is never set and the session is 15 minutes long', async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      accepted({ token: TOKEN, recoveryOnly: false }),
    );
    vi.stubGlobal('fetch', spy);

    await signInToDesk({ email: ' op@example.com ', password: 'hunter22two' });
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    // Trimmed, because a pasted address carries a space more often than not.
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).email).toBe('op@example.com');
  });
});

describe('step two — the second factor', () => {
  it('sends totpCode when that is what was typed, and nothing else', async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      accepted({ token: TOKEN, recoveryOnly: false }),
    );
    vi.stubGlobal('fetch', spy);

    await signInToDesk({ email: 'op@example.com', password: 'pw', totpCode: ' 123456 ' });
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      email: 'op@example.com',
      password: 'pw',
      totpCode: '123456',
    });
  });

  it('sends recoveryCode under its own key — the server treats the two differently', async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      accepted({ token: TOKEN, recoveryOnly: true }),
    );
    vi.stubGlobal('fetch', spy);

    await signInToDesk({ email: 'op@example.com', password: 'pw', recoveryCode: 'ABCDE-FGHJK' });
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).recoveryCode).toBe('ABCDE-FGHJK');
  });

  it('blames the code, not the password, once the password has already been accepted', async () => {
    // ⚠️ THE SERVER'S OWN MESSAGE IS THE SAME EITHER WAY — it refuses to say
    // which half was wrong. On the first step that reticence is the point; on
    // the second it would send the operator back to re-check a password that
    // is fine.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => refusal(401, { message: 'Email, password or code is not right.' })),
    );

    const out = await signInToDesk({ email: 'op@example.com', password: 'pw', totpCode: '000000' });
    expect(out.kind).toBe('refused');
    expect(out.kind === 'refused' ? out.message : '').toMatch(/code/i);
    expect(out.kind === 'refused' ? out.message : '').not.toMatch(/password/i);
  });
});

describe('what comes back on success', () => {
  it('stores the session and reports an ordinary one as writable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => accepted({ token: TOKEN, recoveryOnly: false })),
    );

    await expect(signInToDesk({ email: 'op@example.com', password: 'pw' })).resolves.toEqual({
      kind: 'in',
      recoveryOnly: false,
    });
    expect(window.localStorage.getItem('gg_admin_token')).toBe(TOKEN);
    expect(isRecoveryOnlySession()).toBe(false);
  });

  it('remembers that a recovery-code session is read-only', async () => {
    // ⚠️ THE ONLY COPY OF THIS FACT. `recoveryOnly` is not a JWT claim and
    // GET /admin/auth/me does not return it; dropping it here means the
    // banner never appears and a Full admin meets an unexplained 403 on their
    // first decision.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => accepted({ token: TOKEN, recoveryOnly: true })),
    );

    await expect(
      signInToDesk({ email: 'op@example.com', password: 'pw', recoveryCode: 'ABCDE-FGHJK' }),
    ).resolves.toEqual({ kind: 'in', recoveryOnly: true });
    expect(isRecoveryOnlySession()).toBe(true);
  });

  it('does not call a 200 with no token a sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => accepted({ ok: true })));
    const out = await signInToDesk({ email: 'op@example.com', password: 'pw' });
    expect(out.kind).toBe('refused');
    expect(window.localStorage.getItem('gg_admin_token')).toBeNull();
  });
});
