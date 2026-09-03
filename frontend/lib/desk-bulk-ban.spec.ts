import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BULK_BAN_CAP,
  BULK_BAN_MIN_REASON,
  bulkBanUsers,
  describeSweep,
  isSweepable,
  unsweepableReason,
  type PersonRow,
} from './desk-people';

// ────────────────────────────────────────────────────────────────────
// THE SWEEP THAT WAS HELD BACK UNTIL IT COULD BE HONEST.
//
// 🚨 BULK BAN WAS LEFT OUT DELIBERATELY, NOT LEFT UNDONE. The legacy sweep is
// safe only because its checkbox column greys out already-banned and closed
// accounts; the Desk's row is a single button that opens the Member drawer, so
// a checkbox column meant rebuilding the row — and without one, a confirm
// would name a count it could not vouch for.
//
// The cutover note left the spec, and these pin it: closed accounts are not
// misconduct, the server caps at 50 and skips them itself, and THE CONFIRM
// NAMES THE ELIGIBLE COUNT, NOT THE SELECTED ONE.
// ────────────────────────────────────────────────────────────────────

function person(over: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 'u1',
    username: 'boet',
    kycStatus: null,
    sellerTier: null,
    isBanned: false,
    accountClosedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    kycRequiredAt: null,
    ...over,
  };
}

describe('who can be swept', () => {
  it('an ordinary member can', () => {
    expect(isSweepable(person())).toBe(true);
    expect(unsweepableReason(person())).toBeNull();
  });

  it('🚨 a CLOSED account cannot, because leaving is not misconduct', () => {
    // Every gate already refuses a closed account, so the ban buys nothing —
    // and the audit row is the only thing it leaves behind, where a later
    // reader takes it for misconduct by someone who simply left.
    const closed = person({ accountClosedAt: '2026-08-01T00:00:00.000Z' });
    expect(isSweepable(closed)).toBe(false);
    expect(unsweepableReason(closed)).toMatch(/closed/i);
    expect(unsweepableReason(closed)).not.toMatch(/banned/i);
  });

  it('an already-banned member cannot, so one act is not stamped twice', () => {
    // Re-banning writes a second USER_BAN audit row for one act, so a sweep
    // run twice reads afterwards as two separate offences.
    const banned = person({ isBanned: true });
    expect(isSweepable(banned)).toBe(false);
    expect(unsweepableReason(banned)).toMatch(/already banned/i);
  });

  it('names CLOSED before BANNED when a row is both', () => {
    // The closure is the more important fact: it is the one that makes the
    // ban meaningless rather than merely redundant.
    const both = person({ isBanned: true, accountClosedAt: '2026-08-01T00:00:00.000Z' });
    expect(unsweepableReason(both)).toMatch(/closed/i);
  });
});

describe('🚨 the confirm names what will actually happen', () => {
  it('counts the ELIGIBLE, not the selected', () => {
    // "Ban 12 members" over a selection where four are closed is a promise the
    // call will not keep, and the operator finds out afterwards from a tally —
    // if they read it. This is the whole reason the control was held back.
    const selected = [
      person({ id: 'a' }),
      person({ id: 'b' }),
      person({ id: 'c', isBanned: true }),
      person({ id: 'd', accountClosedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const { eligible, skipped, sentence } = describeSweep(selected);
    expect(eligible).toHaveLength(2);
    expect(skipped).toHaveLength(2);
    expect(sentence).toContain('Ban 2 of the 4 selected');
    expect(sentence).toContain('left alone');
  });

  it('stays plain when nothing is skipped', () => {
    const { sentence } = describeSweep([person({ id: 'a' }), person({ id: 'b' })]);
    expect(sentence).toBe('Ban 2 members.');
  });

  it('says "member", not "members", for one', () => {
    expect(describeSweep([person()]).sentence).toBe('Ban 1 member.');
  });

  it('reports zero eligible without claiming a ban will happen', () => {
    const { eligible, sentence } = describeSweep([person({ isBanned: true })]);
    expect(eligible).toHaveLength(0);
    expect(sentence).toContain('Ban 0 of the 1 selected');
  });
});

describe('the request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts ids and reason to the literal bulk path', async () => {
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ processed: 2, skipped: 0, results: [] }),
    }));
    vi.stubGlobal('fetch', spy);
    await bulkBanUsers(['a', 'b'], 'repeat contact-detail offender');

    // ⚠️ 'bulk-ban' must not be readable as a user id — the backend declares
    // it as its own POST for that reason.
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/users\/bulk-ban$/);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      userIds: ['a', 'b'],
      reason: 'repeat contact-detail offender',
    });
  });

  it('mirrors the server’s own limits so the UI can refuse first', () => {
    // The server caps at 50 and demands 5 characters of reason. Duplicating
    // the numbers here is only safe because they are asserted against the
    // messages the server actually raises — see admin.service.ts.
    expect(BULK_BAN_CAP).toBe(50);
    expect(BULK_BAN_MIN_REASON).toBe(5);
  });
});
