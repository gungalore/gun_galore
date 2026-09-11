// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminsDrawer } from './admins-drawer';
import { setDeskSession, clearDeskToken } from '@/lib/desk-auth';

/**
 * THE DESK — the drawer that hands out admin access, and the reason it records.
 *
 * 🚨 TWO THINGS HERE WERE WRONG IN WAYS A GREEN SUITE HID.
 *
 * 1. The three privilege routes require a `reason` (3–500 chars) and write an
 *    audit row — the only record that anybody was ever made an administrator.
 *    The clients sent none, so every write 400d, while desk-admins.spec.ts
 *    mocked fetch and passed.
 *
 * 2. The role change had NOWHERE to put one. The picker called setAdminRole
 *    straight out of its onChange — no confirm, no screen, no field — so the
 *    single most sensitive write on the platform was one click with no chance
 *    to say why, and no chance to notice the wrong row.
 *
 * ⚠️ .spec.tsx, WITH THE x, or vitest never collects it.
 */

const ADMINS = [
  {
    id: 'adm_1',
    email: 'boet@example.com',
    role: 'MONITORING_ADMIN',
    isActive: true,
    lastLoginAt: null,
  },
];

function stubFetch(impl?: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = impl?.(String(url), init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body ?? { ok: true }),
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Only writes are asserted; a call to the roster read is not one. */
function writes(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method);
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

describe('adding an administrator', () => {
  it('will not send until there is a reason, however complete the rest is', async () => {
    const user = userEvent.setup();
    const spy = stubFetch();
    render(<AdminsDrawer open onClose={() => {}} admins={ADMINS} onChanged={() => {}} />);

    await user.type(
      screen.getByLabelText(/email of the member to promote/i),
      'new@example.com',
    );

    const add = screen.getByRole('button', { name: /^Add as/i });
    expect(add).toBeDisabled();

    // ⚠️ THE FLOOR IS THE SERVER'S: MinLength(3) on CreateAdminDto. Two
    // characters arm nothing, because arming them produces a guaranteed 400
    // the operator meets as a failed drawer rather than a short field.
    await user.type(screen.getByLabelText(/why this person gets admin access/i), 'ok');
    expect(add).toBeDisabled();

    await user.type(
      screen.getByLabelText(/why this person gets admin access/i),
      ' — covering dealer verification',
    );
    expect(add).toBeEnabled();

    await user.click(add);
    await waitFor(() => expect(writes(spy)).toHaveLength(1));
    const [, init] = writes(spy)[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      email: 'new@example.com',
      role: 'MONITORING_ADMIN',
      reason: 'ok — covering dealer verification',
    });
  });
});

describe('changing a role', () => {
  it('picking a role writes NOTHING — it opens a confirm that names the person', async () => {
    const user = userEvent.setup();
    const spy = stubFetch();
    render(<AdminsDrawer open onClose={() => {}} admins={ADMINS} onChanged={() => {}} />);

    await user.click(screen.getByRole('button', { name: /change role/i }));
    // Two pickers are on screen once the row opens (the Add section has one),
    // so reach for the Full admin option inside the row that is editing: it is
    // the second, because the roster renders below the Add section.
    const fullAdminOptions = screen.getAllByRole('button', { name: /Full admin/i });
    await user.click(fullAdminOptions[fullAdminOptions.length - 1]);

    expect(writes(spy)).toHaveLength(0);
    // The confirm restates WHO and WHAT, because the picker it replaced gave
    // the operator no chance to notice they were on the wrong row.
    expect(screen.getByText(/takes effect on their next request/i)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /^Change role$/i });
    expect(confirm).toBeDisabled();

    await user.type(
      screen.getByLabelText(/why this role is changing/i),
      'Taking over payouts from 1 October',
    );
    await user.click(confirm);

    await waitFor(() => expect(writes(spy)).toHaveLength(1));
    const [url, init] = writes(spy)[0];
    expect(String(url)).toMatch(/\/admin\/admins\/adm_1\/role$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      role: 'SUPERADMIN',
      reason: 'Taking over payouts from 1 October',
    });
  });
});

describe('when the server refuses', () => {
  it("shows the server's sentence, not the status line", async () => {
    // 🚨 THE DRAWER USED TO PRINT `err.message`, WHICH IS "400 Bad Request".
    // Nest puts the sentence in the JSON body, so every refusal this surface
    // exists to relay — "No All Outdoor account found for …", "You cannot
    // change your own role" — arrived as three words naming only the shape of
    // the failure.
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            message: 'No All Outdoor account found for new@example.com. Ask them to sign up first.',
            error: 'Bad Request',
            statusCode: 400,
          }),
      })),
    );

    render(<AdminsDrawer open onClose={() => {}} admins={ADMINS} onChanged={() => {}} />);
    await user.type(screen.getByLabelText(/email of the member to promote/i), 'new@example.com');
    await user.type(
      screen.getByLabelText(/why this person gets admin access/i),
      'Covering dealer verification',
    );
    await user.click(screen.getByRole('button', { name: /^Add as/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Ask them to sign up first/);
    expect(alert).not.toHaveTextContent(/Bad Request/);
  });

  it('relays a class-validator array as a sentence rather than as "[object Object]"', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            message: ['Say why this account is being granted admin access.'],
            statusCode: 400,
          }),
      })),
    );

    render(<AdminsDrawer open onClose={() => {}} admins={ADMINS} onChanged={() => {}} />);
    await user.type(screen.getByLabelText(/email of the member to promote/i), 'new@example.com');
    await user.type(screen.getByLabelText(/why this person gets admin access/i), 'because');
    await user.click(screen.getByRole('button', { name: /^Add as/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Say why this account/);
  });
});
