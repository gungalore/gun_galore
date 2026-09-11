import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
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
 * 🚨 AND A TEST IN THIS FILE PINNED A SHAPE THAT 400s. It was called
 * "deactivateAdmin posts to the deactivate route and sends no body" and it
 * asserted `init.body` was undefined — which was correct until the backend
 * made `reason` required on all three privilege routes (2026-09-11), and which
 * PASSED afterwards anyway because the fetch is mocked. A green suite over a
 * feature that could not work is the exact failure this file exists to catch,
 * so the reason assertions below are now the point of the block.
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
  /**
   * ⚠️ toEqual ON THE WHOLE OBJECT, not a property check, so an omitted
   * `reason` fails here rather than as a 400 in front of the operator. The
   * strictness about extra keys is this file's own: main.ts's ValidationPipe
   * sets `whitelist` but NOT `forbidNonWhitelisted`, so the server would strip
   * a stray field silently — which is exactly how a body drifts from the DTO
   * without anything saying so.
   */
  it('createAdmin posts the email, the role and the reason the server expects', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await createAdmin('boet@example.com', 'MONITORING_ADMIN', 'Taking over dealer verification');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'boet@example.com',
      role: 'MONITORING_ADMIN',
      reason: 'Taking over dealer verification',
    });
  });

  it('setAdminRole PATCHes the role and the reason onto that admin', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await setAdminRole('adm_1', 'SUPERADMIN', 'Promoted to handle payouts');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins\/adm_1\/role$/);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      role: 'SUPERADMIN',
      reason: 'Promoted to handle payouts',
    });
  });

  /**
   * 🚨 THIS TEST USED TO ASSERT THE OPPOSITE — "sends no body" — and it was
   * right until DeactivateAdminDto existed. Switching an admin off is the
   * emergency control for a compromised operator, which makes it precisely
   * the action whose "why" somebody reads back at 3am; before the DTO the
   * controller took no @Body() at all, so there was nowhere to put one and no
   * audit row was written.
   */
  it('deactivateAdmin posts the reason, which it used to send no body at all for', async () => {
    const spy = stubFetch({ id: 'adm_1' });
    await deactivateAdmin('adm_1', 'Left the company today');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/admins\/adm_1\/deactivate$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Left the company today' });
  });

  it('sends the reason verbatim — it is a record, not a form field to tidy', async () => {
    // The drawer trims before calling; nothing here re-words, truncates or
    // capitalises. What the operator typed is what the audit row says.
    const spy = stubFetch({});
    const typed = 'Compromised laptop — access pulled pending the SAPS report';
    await deactivateAdmin('adm_1', typed);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).reason).toBe(typed);
  });

  it('encodes an id rather than pasting it into the path', async () => {
    const spy = stubFetch({});
    await deactivateAdmin('adm/../1', 'housekeeping');
    expect(String(spy.mock.calls[0][0])).toContain('adm%2F..%2F1');
  });
});

describe('the reason floor', () => {
  /**
   * ⚠️ MIRRORED FROM create-admin.dto.ts, WHERE THE FLOOR IS ENFORCED. The
   * drawer arms its buttons on this number; if the DTO's MinLength moves and
   * this does not, the button lights up for a request the server refuses and
   * the operator meets a 400 instead of a full field.
   */
  it('matches the server: three characters, five hundred at most', () => {
    expect(ADMIN_REASON_MIN).toBe(3);
    expect(ADMIN_REASON_MAX).toBe(500);
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

describe('the monitoring role is described as what it actually is', () => {
  const note = ADMIN_ROLE_NOTE.MONITORING_ADMIN;

  /**
   * 🚨 THIS BLOCK USED TO ASSERT THE OPPOSITE, AND THAT WAS CORRECT AT THE
   * TIME. Until the role guard landed, MONITORING_ADMIN was a label with no
   * teeth — SuperadminGuard covered three routes and every other admin
   * endpoint took any logged-in admin — so the copy was required to warn that
   * it was not enforced, and this test failed if anyone tidied that away.
   *
   * AdminJwtGuard now enforces it: deny-by-default on mutating methods, role
   * and isActive read off the row per request rather than out of the access
   * token. So the copy flipped, and the test flipped with it — deliberately,
   * in the same change as the guard, which is the only circumstance in which
   * either may move.
   */
  it('no longer carries the stale "not enforced" warning', () => {
    expect(note).not.toMatch(/not enforced/i);
  });

  it('says plainly that it cannot change anything', () => {
    expect(note).toMatch(/change nothing|cannot/i);
  });

  it('names what it cannot touch, rather than leaving it abstract', () => {
    expect(note).toMatch(/payout/i);
    expect(note).toMatch(/refund/i);
  });

  it('says the restriction applies to someone already signed in', () => {
    // The guard reads the row per request, so a demotion does not wait for
    // the access token to expire (fifteen minutes now, not the eight hours
    // this comment used to name). That is the part an operator acting on a
    // compromised account needs to know.
    expect(note).toMatch(/immediately|already signed in/i);
  });

  it('the full-admin note stays plain — no warning where there is nothing to warn about', () => {
    expect(ADMIN_ROLE_NOTE.SUPERADMIN).not.toMatch(/not enforced|cannot/i);
  });
});
