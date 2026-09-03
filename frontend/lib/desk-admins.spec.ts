import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ROLE_LABEL,
  ADMIN_ROLE_NOTE,
  ASSIGNABLE_ROLES,
  createAdmin,
  deactivateAdmin,
  setAdminRole,
} from './desk-site';

/**
 * ADMIN ACCOUNTS — the three writes, and the one sentence that must stay true.
 *
 * 🚨 THIS SURFACE EXISTS BECAUSE THE CUTOVER TOOK IT AWAY. Deleting the legacy
 * panel left the Desk's roster listing administrators with no control on any
 * row, so removing a compromised one meant a database write. These pin the
 * request shapes, and — more importantly — the copy.
 *
 * The copy matters more than the plumbing here. `MONITORING_ADMIN` is
 * DOCUMENTED as read-only and is NOT ENFORCED: SuperadminGuard sits on exactly
 * the three admin-management routes and every other admin endpoint takes any
 * logged-in admin, so that role can currently release a payout, refund a
 * buyer and ban a member. A picker that called it "read-only" would hand
 * somebody full control while its author believed they had handed out a
 * viewer — strictly worse than having no picker at all. The test below fails
 * if anyone tidies that warning away before the server-side gate lands.
 */

function stubFetch(payload: unknown) {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the three writes', () => {
  it('createAdmin posts the email and role the server expects', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await createAdmin('boet@example.com', 'MONITORING_ADMIN');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'boet@example.com',
      role: 'MONITORING_ADMIN',
    });
  });

  it('setAdminRole PATCHes the role onto that admin', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await setAdminRole('adm_1', 'SUPERADMIN');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins\/adm_1\/role$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ role: 'SUPERADMIN' });
  });

  it('deactivateAdmin posts to the deactivate route and sends no body', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await deactivateAdmin('adm_1');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins\/adm_1\/deactivate$/);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });

  it('encodes an id rather than pasting it into the path', async () => {
    const spy = stubFetch({});
    await deactivateAdmin('adm/../1');
    expect(String(spy.mock.calls[0][0])).toContain('adm%2F..%2F1');
  });
});

describe('the roles offered', () => {
  it('offers exactly the two the server will accept', () => {
    // Mirrors ASSIGNABLE_ROLES in backend/src/admin/dto/create-admin.dto.ts.
    expect([...ASSIGNABLE_ROLES]).toEqual(['SUPERADMIN', 'MONITORING_ADMIN']);
  });

  it('does not offer the legacy ADMIN tier, but still renders it where it exists', () => {
    // Old rows carry it; assigning it would add a third meaning to a field
    // that already has one too many.
    expect([...ASSIGNABLE_ROLES]).not.toContain('ADMIN');
    expect(ADMIN_ROLE_LABEL.ADMIN).toBeTruthy();
  });

  it('names them as the operator reads them, not as the enum spells them', () => {
    expect(ADMIN_ROLE_LABEL.SUPERADMIN).toBe('Full admin');
    expect(ADMIN_ROLE_LABEL.MONITORING_ADMIN).toBe('Monitoring admin');
  });
});

describe('🚨 the monitoring role must not be described as restricted', () => {
  const note = ADMIN_ROLE_NOTE.MONITORING_ADMIN;

  it('never claims read-only, view-only or restricted access', () => {
    // The schema's own words: "(Currently not enforced on individual endpoints
    // yet — that gate work is tracked separately.)" Until that lands, any of
    // these phrasings is a false promise about who can move money.
    for (const lie of [/read-?only(?!\s*—\s*but)/i, /\bcannot\b/i, /\brestricted\b/i, /\bview only\b/i]) {
      expect(note).not.toMatch(lie);
    }
  });

  it('says outright that it is not enforced yet', () => {
    expect(note).toMatch(/not enforced/i);
  });

  it('says what it can still do, in terms of consequence', () => {
    expect(note).toMatch(/money/i);
  });

  it('the full-admin note stays plain — no warning where there is nothing to warn about', () => {
    expect(ADMIN_ROLE_NOTE.SUPERADMIN).not.toMatch(/not enforced/i);
  });
});
