/**
 * THE DESK — signing in, in one or two steps.
 *
 * 🚨 THE SIGN-IN SCREEN NEVER READ THE REFUSAL BODY, AND THAT BECAME A LIE THE
 * DAY TOTP LANDED. `POST /admin/auth/login` answers an enrolled admin who sent
 * no code with a 401 carrying `code: 'TOTP_REQUIRED'` — the password was
 * RIGHT. The page treated every non-429 refusal identically and printed "That
 * email and password do not match.", so an operator with an authenticator was
 * told their correct password was wrong, on every attempt, with no code box
 * anywhere on screen.
 *
 * This module is the step machine, kept out of the page so it can be tested
 * without a DOM: the page owns which fields are visible, this owns what the
 * server just said.
 */
import { DESK_API_URL, setDeskSession } from './desk-auth';

const LOGIN_PATH = '/admin/auth/login';

export interface DeskSignInInput {
  email: string;
  password: string;
  /** Six digits from the authenticator app. */
  totpCode?: string;
  /** One of the ten XXXXX-XXXXX codes. Single use. */
  recoveryCode?: string;
}

/**
 * ⚠️ `recoveryOnly` IS CARRIED OUT OF HERE, NOT DROPPED. A session opened with
 * a recovery code can read and cannot write, and the only places that fact
 * ever appears on the wire are this response and the refresh response. The
 * caller does not have to do anything with it — setDeskSession has already
 * stored it — but the page shows a sentence about it before the boards load,
 * which is kinder than the operator discovering it on their first 403.
 */
export type DeskSignInOutcome =
  | { kind: 'in'; recoveryOnly: boolean }
  /** The password was accepted. Ask for the second factor. */
  | { kind: 'need-code' }
  | { kind: 'refused'; message: string }
  | { kind: 'throttled'; message: string }
  | { kind: 'unreachable'; message: string };

/**
 * The `code` a refusal carries, if it carries one.
 *
 * ⚠️ ONLY `TOTP_REQUIRED` IS EVER THROWN. `TOTP_ENROLMENT_REQUIRED` exists in
 * exactly one place in the backend — a doc comment in admin-auth.service.ts —
 * and no handler raises it: when ADMIN_TOTP_REQUIRED is on and the admin has
 * never enrolled, login SUCCEEDS with `recoveryOnly: true` so they can reach
 * the enrol route. So there is deliberately no branch here claiming the server
 * produces that state; the read-only session it really issues is what the
 * banner and the account drawer handle.
 */
function refusalCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

export async function signInToDesk(input: DeskSignInInput): Promise<DeskSignInOutcome> {
  const secondStep = Boolean(input.totpCode || input.recoveryCode);

  let res: Response;
  try {
    res = await fetch(`${DESK_API_URL}${LOGIN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The refresh cookie (gg_admin_rt, httpOnly, path /api/admin/auth) is
      // SET by this response. Without credentials there is no refresh at all
      // and the operator is back to being ejected every fifteen minutes.
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        ...(input.totpCode ? { totpCode: input.totpCode.trim() } : {}),
        ...(input.recoveryCode ? { recoveryCode: input.recoveryCode.trim() } : {}),
      }),
    });
  } catch {
    return { kind: 'unreachable', message: 'We could not reach the server. Check your connection.' };
  }

  if (res.status === 429) {
    return { kind: 'throttled', message: 'Too many attempts. Wait a minute and try again.' };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (refusalCode(body) === 'TOTP_REQUIRED') return { kind: 'need-code' };

    // ⚠️ TWO SENTENCES, CHOSEN BY WHICH STEP WE ARE ON, because the server's
    // own message is deliberately the same either way — "Email, password or
    // code is not right." refuses to say which, so the roster cannot be
    // enumerated. On the first step that reticence is the whole point. On the
    // second we already know the password was accepted once, so repeating
    // "that email and password do not match" would send the operator back to
    // re-check a password that is fine.
    //
    // ⚠️ AND THE SECOND SENTENCE MUST NOT PROMISE THAT RETRYING WORKS. After
    // MAX_FAILED_LOGINS (8) the account is locked for LOCKOUT_MS (15
    // minutes), and the locked branch answers with the SAME generic refusal —
    // deliberately indistinguishable, so this client cannot tell a wrong code
    // from a locked account. The copy used to read "Wait for your app to show
    // the next one, or use a recovery code", and both of those are refused
    // while the lock stands: the lock is checked BEFORE the recovery-code
    // branch, so the codes appear dead too. The realistic way in is the one
    // the backend names on the confirm route — a phone clock that is not set
    // automatically — which rejects every code, reaches eight failures inside
    // a minute, and then spends fifteen minutes advising a retry loop that
    // cannot succeed. So the sentence names the lock instead of denying it.
    // The 429 branch above does NOT cover this: the durable lock answers 401.
    return {
      kind: 'refused',
      message: secondStep
        ? 'That code was not accepted. Wait for your app to show the next one, or use a ' +
          'recovery code. If several attempts in a row are refused, the account locks for ' +
          '15 minutes — check that your phone’s clock is set automatically, then try again ' +
          'after that.'
        : 'That email and password do not match.',
    };
  }

  const json = (await res.json().catch(() => null)) as
    | { token?: unknown; recoveryOnly?: unknown }
    | null;
  const token = typeof json?.token === 'string' ? json.token : null;
  if (!token) {
    return { kind: 'refused', message: 'Signed in, but no session came back. Try again.' };
  }

  const recoveryOnly = json?.recoveryOnly === true;
  setDeskSession({ token, recoveryOnly });
  return { kind: 'in', recoveryOnly };
}
