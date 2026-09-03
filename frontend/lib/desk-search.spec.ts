import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEARCH_MIN_CHARS,
  emptySearch,
  fetchDeskSearch,
  memberContext,
  memberLabel,
  orderContext,
  searchHref,
  searchIsEmpty,
  shortRef,
  type SearchOrderWire,
  type SearchUserWire,
} from './desk-search';

// ────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH — the reach four cutover entries said the Desk did not have.
//
// 🚨 EVERY PART OF THIS ALREADY EXISTED. GET /admin/search, with a comment
// saying it "powers the type-ahead in the admin layout header". SearchPalette,
// finished, with arrow keys and grouping. They were never joined, and the
// handler that should have joined them read `() => undefined` under a comment
// asserting no search endpoint existed.
//
// So these tests pin the JOIN, not the palette: what a row says, and where it
// goes. Both are places a plausible-looking mistake is invisible on screen —
// a member row that opens the wrong person reads exactly like one that opens
// the right person.
// ────────────────────────────────────────────────────────────────────

function user(over: Partial<SearchUserWire> = {}): SearchUserWire {
  return {
    id: 'usr_1',
    username: 'boet',
    email: 'boet@example.com',
    sellerTier: null,
    isBanned: false,
    accountClosedAt: null,
    closure: null,
    ...over,
  };
}

describe('what a member row says', () => {
  it('is the username, never the email', () => {
    // ⚠️ THE EMAIL IS OFTEN WHAT WAS TYPED TO FIND THEM, and it still must not
    // be printed: a palette is a list of people, and the project rule keeps
    // identity off any surface that merely lists them. Trust and safety
    // dropped the same column for the same reason; the Member drawer puts
    // identity behind a deliberate reveal. Opening the row IS the reveal.
    const u = user({ email: 'gerhard.fourie@example.com' });
    expect(memberLabel(u)).toBe('boet');
    expect(memberLabel(u)).not.toContain('@');
  });

  it('falls back when there is no username, without inventing one', () => {
    expect(memberLabel(user({ username: null }))).toBe('no username');
  });

  it('🚨 a closed account says who it WAS', () => {
    // A closure releases username, email and phone back into the uniqueness
    // namespace, so the live columns are blanked or recycled. The server
    // searches the closure snapshot on purpose — operator, 2026-08-22: "if a
    // user commited a crime or something they cant just vanish by deleting
    // and wiping evidence." Rendering the recycled live column would make the
    // preserved record unreadable, which is the same as not keeping it.
    const closed = user({
      username: null,
      email: 'closed+cmsq@accounts.invalid',
      accountClosedAt: '2026-08-01T00:00:00.000Z',
      closure: {
        closedUsername: 'oldboet',
        closedEmail: 'old@example.com',
        closedFirstName: 'A',
        closedLastName: 'B',
        closedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    expect(memberLabel(closed)).toBe('oldboet');
    expect(memberLabel(closed)).not.toContain('accounts.invalid');
  });

  it('leads with closed rather than banned, because closed removes the decision', () => {
    const both = user({
      isBanned: true,
      accountClosedAt: '2026-08-01T00:00:00.000Z',
      closure: {
        closedUsername: 'x',
        closedEmail: null,
        closedFirstName: null,
        closedLastName: null,
        closedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    expect(memberContext(both)).toContain('account closed');
    expect(memberContext(both)).not.toContain('banned');
  });

  it('says banned when they are still here', () => {
    expect(memberContext(user({ isBanned: true }))).toContain('banned');
  });

  it('says nothing at all about an ordinary member', () => {
    // An empty context is right: every row carrying a tag makes the tags
    // worthless, which is the same argument the credits card makes about amber.
    expect(memberContext(user())).toBe('');
  });
});

describe('the mono reference column', () => {
  it('prefers a real reference, which is what the operator is holding', () => {
    expect(shortRef('GG-ORD-0042', 'clx123456789')).toBe('GG-ORD-0042');
  });

  it('shortens a cuid rather than pretending it is quotable', () => {
    expect(shortRef(null, 'clx123456789abcdef')).toBe('clx12345…');
  });

  it('treats a blank reference as absent, not as a reference', () => {
    expect(shortRef('   ', 'clx123456789abcdef')).toBe('clx12345…');
  });

  it('leaves a short id alone rather than truncating to nothing', () => {
    expect(shortRef(null, 'abc')).toBe('abc');
  });
});

describe('an order row says how big it is', () => {
  function order(over: Partial<SearchOrderWire> = {}): SearchOrderWire {
    return {
      id: 'ord_1',
      orderReference: 'GG-ORD-1',
      status: 'AWAITING_PAYMENT',
      buyerTotal: 100_00,
      createdAt: '2026-09-01T00:00:00.000Z',
      buyer: { username: 'boet' },
      _count: { transactions: 3 },
      ...over,
    };
  }

  it('counts the lines, so a multi-seller cart reads as one row on purpose', () => {
    expect(orderContext(order())).toContain('3 lines');
  });

  it('says "1 line", not "1 lines"', () => {
    expect(orderContext(order({ _count: { transactions: 1 } }))).toContain('1 line');
    expect(orderContext(order({ _count: { transactions: 1 } }))).not.toContain('1 lines');
  });

  it('renders the status in words rather than SCREAMING_SNAKE', () => {
    expect(orderContext(order())).toContain('awaiting payment');
  });
});

describe('🚨 where a result opens', () => {
  it('an order and a transaction take DIFFERENT params', () => {
    // The single most damaging mistake available here. `?order=` resolves
    // through fetchOrderCard, which wants an ORDER id and finds its first
    // line; a transaction has no cart parent and opens the drawer directly.
    // Passing a transaction id to `?order=` 404s against an order that does
    // not exist, and reads as "this sale is missing" rather than "wrong id".
    expect(searchHref('order', 'ord_1')).toBe('/admin/desk/ledger?order=ord_1');
    expect(searchHref('transaction', 'txn_1')).toBe('/admin/desk/ledger?txn=txn_1');
  });

  it('members go to People and listings to the Pile', () => {
    expect(searchHref('member', 'usr_1')).toBe('/admin/desk/people?member=usr_1');
    expect(searchHref('listing', 'lst_1')).toBe('/admin/desk?listing=lst_1');
  });

  it('encodes the id rather than pasting it into the query', () => {
    expect(searchHref('member', 'a b&c=d')).toContain('a%20b%26c%3Dd');
  });

  it('every kind has a destination — no silent no-op', () => {
    for (const kind of ['member', 'listing', 'order', 'transaction'] as const) {
      expect(searchHref(kind, 'x')).toMatch(/^\/admin\/desk/);
    }
  });
});

describe('the request itself', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not call the server below the server’s own floor', async () => {
    // The endpoint returns empty sets under 2 characters, so asking is pure
    // cost and a guaranteed "no matches" that reads as a fact about the data.
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await fetchDeskSearch('a');
    expect(spy).not.toHaveBeenCalled();
    expect(SEARCH_MIN_CHARS).toBe(2);
  });

  it('measures the floor against the TRIMMED query', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await fetchDeskSearch('  a  ');
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the trimmed query, encoded', async () => {
    // ⚠️ THE PARAMS ARE DECLARED SO THE CALL TUPLE IS TYPED. Without them the
    // mock's args are `[]` and `calls[0][0]` fails to compile — vitest infers
    // the tuple from the implementation, not from what the caller passes.
    const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(emptySearch()),
    }));
    vi.stubGlobal('fetch', spy);
    await fetchDeskSearch('  boet & co  ');
    expect(String(spy.mock.calls[0][0])).toContain('q=boet%20%26%20co');
  });

  it('returns a fresh empty object, never a shared one', () => {
    // A shared constant handed back to a caller that mutates it would poison
    // every later "no results" state.
    const a = emptySearch();
    a.users.push(user());
    expect(emptySearch().users).toHaveLength(0);
  });

  it('knows empty from non-empty across all four collections', () => {
    expect(searchIsEmpty(emptySearch())).toBe(true);
    for (const key of ['users', 'listings', 'transactions', 'orders'] as const) {
      const w = emptySearch();
      (w[key] as unknown[]).push({});
      expect(searchIsEmpty(w), `${key} should count as non-empty`).toBe(false);
    }
  });
});
