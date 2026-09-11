// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RecoveryNotice } from './recovery-notice';
import { clearDeskToken, setDeskSession } from '@/lib/desk-auth';

/**
 * THE DESK — the read-only session says so, on every board.
 *
 * 🚨 THE FAILURE THIS PREVENTS IS "THE PANEL IS BROKEN". A session opened with
 * a recovery code is refused on every write by AdminJwtGuard — recoveryOnly is
 * checked BEFORE the role, so even a Full admin can only read — and nothing
 * else on any surface would have said why: it is not a JWT claim and
 * GET /admin/auth/me does not return it. Without this strip the only signal is
 * the pattern of 403s.
 *
 * ⚠️ .spec.tsx, WITH THE x. vitest.config.ts includes
 * `components/ ** / *.spec.tsx`; a `.spec.ts` under components/ is never
 * collected — it reports nothing, fails nothing, and passes the deploy gate by
 * not existing.
 */

/** A token whose payload decodes. `amr` is the only claim read here. */
function tokenWith(amr: string[]): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + 900, amr };
  return `head.${btoa(JSON.stringify(payload))}.sig`;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  clearDeskToken();
});

describe('when there is nothing to say', () => {
  it('renders nothing at all for an ordinary session', () => {
    setDeskSession({ token: tokenWith(['pwd', 'otp']), recoveryOnly: false });
    const { container } = render(<RecoveryNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no session', () => {
    const { container } = render(<RecoveryNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('when the session can read and not write', () => {
  it('says so, and says what to do about it', () => {
    setDeskSession({ token: tokenWith(['pwd', 'recovery']), recoveryOnly: true });
    render(<RecoveryNotice />);

    const strip = screen.getByRole('status');
    expect(strip).toHaveTextContent(/read everything and change nothing/i);
    // The way out is enrol → sign out → sign in, because confirming an
    // authenticator revokes every other session including this one.
    expect(strip).toHaveTextContent(/sign out and back in/i);
  });

  it('offers the account drawer when the shell passes a way to open it', async () => {
    setDeskSession({ token: tokenWith(['pwd', 'recovery']), recoveryOnly: true });
    const onEnrol = vi.fn();
    render(<RecoveryNotice onEnrol={onEnrol} />);

    const button = screen.getByRole('button', { name: /open your account/i });
    await act(async () => {
      button.click();
    });
    expect(onEnrol).toHaveBeenCalledTimes(1);
  });

  it('appears without a reload when a refresh reports the session read-only mid-board', async () => {
    // ⚠️ THE STORE IS SUBSCRIBED TO, NOT READ ONCE. The flag changes when a
    // silent refresh answers — in a tab that never saw a login response — and
    // localStorage fires no event in the tab that wrote it, so a
    // read-on-mount banner would be correct only after a reload.
    setDeskSession({ token: tokenWith(['pwd']), recoveryOnly: false });
    render(<RecoveryNotice />);
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      setDeskSession({ token: tokenWith(['pwd']), recoveryOnly: true });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('trusts amr:recovery even when the stored flag was never written', () => {
    // A tab restored from storage by another window, say. This direction is
    // safe; the converse is NOT — admin-auth.service.ts issues
    // recoveryOnly:true with amr:['pwd'] when ADMIN_TOTP_REQUIRED is on and
    // the admin has never enrolled, so a missing 'recovery' proves nothing.
    // That is why the stored flag exists at all.
    window.localStorage.setItem('gg_admin_token', tokenWith(['pwd', 'recovery']));
    render(<RecoveryNotice />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
