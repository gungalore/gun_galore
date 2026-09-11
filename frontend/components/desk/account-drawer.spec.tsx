// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDrawer } from './account-drawer';
import { setDeskSession, clearDeskToken } from '@/lib/desk-auth';

/**
 * THE DESK — enrolling an authenticator, and the ten codes that come with it.
 *
 * 🚨 THE TEN RECOVERY CODES ARE RETURNED EXACTLY ONCE. They are bcrypt-hashed
 * on the way in, so nothing — not the route again, not /admin/auth/me, not
 * somebody with psql — can show them a second time. The screen below is the
 * only chance anybody ever gets, which is why an accidental Escape must not
 * close it: Drawer wires Escape and a backdrop press straight to onClose.
 *
 * ⚠️ .spec.tsx, WITH THE x, or vitest never collects it and this passes by not
 * existing.
 */

const ME_NOT_ENROLLED = {
  id: 'adm_1',
  email: 'op@example.com',
  role: 'SUPERADMIN',
  firstName: null,
  lastName: null,
  totpConfirmedAt: null,
  totpEnrolled: false,
  remainingRecoveryCodes: 0,
  totpRequired: false,
};

const CODES = [
  'ABCDE-FGHJK',
  'BCDEF-GHJKM',
  'CDEFG-HJKMN',
  'DEFGH-JKMNP',
  'EFGHJ-KMNPQ',
  'FGHJK-MNPQR',
  'GHJKM-NPQRS',
  'HJKMN-PQRST',
  'JKMNP-QRSTU',
  'KMNPQ-RSTUV',
];

function stubRoutes(overrides: Record<string, unknown> = {}) {
  const spy = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(url);
    const body = path.endsWith('/admin/auth/me')
      ? (overrides.me ?? ME_NOT_ENROLLED)
      : path.endsWith('/totp/enrol')
        ? {
            secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/All%20Outdoor:op@example.com?secret=JBSWY3DP',
            alreadyEnrolled: false,
          }
        : { confirmed: true, recoveryCodes: CODES, otherSessionsEnded: 2 };
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  window.localStorage.clear();
  setDeskSession({
    token: `head.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 }))}.sig`,
    recoveryOnly: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDeskToken();
});

async function enrolAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /set up an authenticator/i }));
  await user.type(
    await screen.findByLabelText(/six-digit code from your authenticator/i),
    '123456',
  );
  await user.click(screen.getByRole('button', { name: /^Confirm$/i }));
}

describe('setting up the second factor', () => {
  it('shows the secret as letters as well as a QR — a dim screen does not always scan', async () => {
    const user = userEvent.setup();
    stubRoutes();
    render(<AccountDrawer open onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /set up an authenticator/i }));

    // Grouped in fours, because 32 characters of look-alikes is where a
    // mistyped one hides.
    expect(await screen.findByText(/JBSW Y3DP EHPK/)).toBeInTheDocument();
    expect(screen.getByTitle(/adds this Desk account to your authenticator/i)).toBeInTheDocument();
  });

  it('does not send a password on a FIRST enrolment — the server only wants one when replacing', async () => {
    const user = userEvent.setup();
    const spy = stubRoutes();
    render(<AccountDrawer open onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /set up an authenticator/i }));

    const enrol = spy.mock.calls.find(([url]) => String(url).endsWith('/totp/enrol'));
    // An empty string would fail validation rather than be ignored, so the key
    // is absent entirely.
    expect(JSON.parse(String((enrol?.[1] as RequestInit).body))).toEqual({});
  });
});

describe('the ten recovery codes', () => {
  it('renders all ten and says they cannot be read again', async () => {
    const user = userEvent.setup();
    stubRoutes();
    render(<AccountDrawer open onClose={() => {}} />);
    await enrolAndConfirm(user);

    for (const code of CODES) {
      expect(await screen.findByText(code)).toBeInTheDocument();
    }
    expect(screen.getByText(/cannot be read again/i)).toBeInTheDocument();
    // Confirming revokes every other session; the number is the operator's
    // warning that a device they are still holding has just been signed out.
    expect(screen.getByText(/2 other signed-in devices were signed out/i)).toBeInTheDocument();
  });

  it('refuses to close on Escape until the operator says they have written them down', async () => {
    const user = userEvent.setup();
    stubRoutes();
    const onClose = vi.fn();
    render(<AccountDrawer open onClose={onClose} />);
    await enrolAndConfirm(user);
    await screen.findByText(CODES[0]);

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps Done disabled until the tick — the tick IS the deliberate act', async () => {
    const user = userEvent.setup();
    stubRoutes();
    render(<AccountDrawer open onClose={() => {}} />);
    await enrolAndConfirm(user);

    const done = await screen.findByRole('button', { name: /^Done$/i });
    expect(done).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(done).toBeEnabled();
  });

  it('offers a copy control and no download — an <a download> is unreliable in standalone iOS', async () => {
    const user = userEvent.setup();
    stubRoutes();
    render(<AccountDrawer open onClose={() => {}} />);
    await enrolAndConfirm(user);

    expect(await screen.findByRole('button', { name: /copy all ten/i })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
