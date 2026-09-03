import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SALE_SEGMENTS,
  fetchSalePage,
  saleStateWords,
  saleTone,
  type SaleRow,
} from './desk-transactions';

// ────────────────────────────────────────────────────────────────────
// THE SALES BOOK — recorded as unbuildable, delivered by one where-clause.
//
// getTransactions pinned paymentStatus on every call, defaulting to HELD with
// no way to ask for anything else as a set. "The order book with the
// needs-attention filter is not built" therefore described a missing branch,
// not a missing feature.
//
// 🚨 AND THE ENDPOINT WAS LEAKING. Its include selected firstName, lastName
// and email for BOTH parties, for a page that has since been deleted — so
// every row of a sales list would have carried two people's real names and
// addresses into the browser to render a column the Desk's own rule forbids.
// Corrected at the select rather than filtered on the way out: data that
// never arrives cannot be rendered by accident.
// ────────────────────────────────────────────────────────────────────

function row(over: Partial<SaleRow> = {}): SaleRow {
  return {
    id: 'txn_1',
    paymentStatus: 'HELD',
    buyerTotal: 100_00,
    sellerPayout: 90_00,
    createdAt: '2026-09-01T00:00:00.000Z',
    paidAt: '2026-09-01T00:00:00.000Z',
    releasedAt: null,
    payoutHeldAt: null,
    listing: { title: 'A rifle', referenceNumber: 'GG-1' },
    buyer: { id: 'u1', username: 'boet' },
    seller: { id: 'u2', username: 'ander' },
    ...over,
  };
}

function stub(payload: unknown) {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('the segments', () => {
  it('opens on the money-in-flight queue, matching the server default', () => {
    expect(SALE_SEGMENTS[0].value).toBe('HELD');
  });

  it('offers ALL, which is the branch that did not exist', () => {
    expect(SALE_SEGMENTS.map((s) => s.value)).toContain('ALL');
  });
});

describe('the request', () => {
  it('sends status, page and limit', async () => {
    const spy = stub({ transactions: [], total: 0 });
    await fetchSalePage('ALL', 2);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('status=ALL');
    expect(url).toContain('page=2');
  });

  it('passes a deep-link filter straight through', async () => {
    const spy = stub({ transactions: [], total: 0 });
    await fetchSalePage('HELD', 1, 'dispatch-overdue');
    expect(String(spy.mock.calls[0][0])).toContain('filter=dispatch-overdue');
  });

  it('omits the filter when there is none, rather than sending empty', async () => {
    const spy = stub({ transactions: [], total: 0 });
    await fetchSalePage('HELD', 1);
    expect(String(spy.mock.calls[0][0])).not.toContain('filter=');
  });

  it('🚨 reads `transactions`, which is what the endpoint returns', async () => {
    // Same trap as the listings register's `listings`. Reading `.rows` gives
    // an empty book beside a correct-looking total — a quiet week, not a bug.
    stub({ transactions: [row(), row({ id: 'txn_2' })], total: 41 });
    const page = await fetchSalePage('ALL', 1);
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(41);
  });

  it('survives a shape it has never seen without throwing', async () => {
    stub({ nonsense: true });
    const page = await fetchSalePage('ALL', 1);
    expect(page.rows).toEqual([]);
  });
});

describe('🚨 a payout hold is not a payment status, and the row says both', () => {
  it('a released sale with a hold reads as held, not as paid out', () => {
    // The trap in both directions. Rendering only "released" hides money the
    // seller is owed and is not getting this run; rendering only "held"
    // suggests the buyer's payment never cleared. Both are wrong and both
    // look completely normal.
    const held = row({ paymentStatus: 'RELEASED', releasedAt: 'x', payoutHeldAt: 'y' });
    expect(saleStateWords(held)).toContain('released');
    expect(saleStateWords(held)).toContain('payout held');
    expect(saleTone(held)).toBe('warn');
  });

  it('a plain released sale is unremarkable', () => {
    const r = row({ paymentStatus: 'RELEASED', releasedAt: 'x' });
    expect(saleStateWords(r)).toBe('released');
    expect(saleTone(r)).toBe('ok');
  });

  it('a dispute is the loudest state', () => {
    expect(saleTone(row({ paymentStatus: 'DISPUTED' }))).toBe('bad');
  });

  it('renders a status in words rather than SCREAMING_SNAKE', () => {
    expect(saleStateWords(row({ paymentStatus: 'PENDING_ADMIN_VERIFICATION' }))).toBe(
      'pending admin verification',
    );
  });
});
