import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LISTINGS_PAGE_SIZE,
  LISTING_SEGMENTS,
  fetchDeadStock,
  fetchListingPage,
  segmentLabel,
} from './desk-listings';

// ────────────────────────────────────────────────────────────────────
// BROWSING LISTINGS — the half of /admin/listings that reach did not cover.
//
// Global search already opened any listing by id, reference, make or model,
// and the drawer always accepted an arbitrary id. This is for the operator
// who does NOT yet know which listing they want.
//
// 🚨 THE WIRE CALLS THE ARRAY `listings`, NOT `rows`. getListings returns
// { listings, total, page, limit }, and this module is the only place that
// shape is translated. Reading `.rows` would render an empty register beside
// a correct-looking total — precisely the failure the alerts inbox shipped
// once, where a type claiming an envelope over a bare array showed
// "0 unresolved" with alerts waiting.
// ────────────────────────────────────────────────────────────────────

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
  it('opens on the only segment with a decision waiting in it', () => {
    // ⚠️ AND IT MATCHES THE SERVER'S OWN DEFAULT. getListings falls back to
    // PENDING_REVIEW when no status is asked for, so a board defaulting to
    // anything else would paint a different list on first render than on a
    // refresh, with nothing on screen to explain the change.
    expect(LISTING_SEGMENTS[0].value).toBe('PENDING_REVIEW');
  });

  it('offers a way to see everything, which the status filter alone cannot', () => {
    expect(LISTING_SEGMENTS.map((s) => s.value)).toContain('ALL');
  });

  it('labels segments in the operator’s words, not the enum’s', () => {
    expect(segmentLabel('PENDING_REVIEW')).toBe('Awaiting review');
    expect(segmentLabel('CANCELLED')).toBe('Taken down');
    expect(segmentLabel('ACTIVE')).toBe('Live');
  });
});

describe('the request', () => {
  it('sends the segment, page and limit', async () => {
    const spy = stub({ listings: [], total: 0 });
    await fetchListingPage('ACTIVE', '', 3);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('page=3');
    expect(url).toContain(`limit=${LISTINGS_PAGE_SIZE}`);
  });

  it('does not send a search the server would ignore', async () => {
    // Under two characters the server applies no search clause. Sending it
    // anyway makes a request whose result does not match the box being typed
    // in — the list would look unfiltered while the box says otherwise.
    const spy = stub({ listings: [], total: 0 });
    await fetchListingPage('ALL', 'a', 1);
    expect(String(spy.mock.calls[0][0])).not.toContain('search=');
  });

  it('sends a real search, trimmed', async () => {
    const spy = stub({ listings: [], total: 0 });
    await fetchListingPage('ALL', '  cz 457 ', 1);
    // ⚠️ ASSERT THE DECODED VALUE, NOT THE ENCODING. URLSearchParams writes a
    // space as '+' while encodeURIComponent writes '%20'; both are valid and
    // both decode to a space server-side. A test pinned to one spelling
    // fails the moment the query is built a different, equally correct way —
    // which is what happened here on the first run.
    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.searchParams.get('search')).toBe('cz 457');
  });
});

describe('🚨 reading the response', () => {
  it('reads `listings`, which is what the endpoint actually returns', async () => {
    stub({ listings: [{ id: 'l1' }, { id: 'l2' }], total: 97, page: 2, limit: 30 });
    const page = await fetchListingPage('ALL', '', 2);
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(97);
    expect(page.page).toBe(2);
  });

  it('also survives a `rows` envelope, rather than rendering empty', async () => {
    stub({ rows: [{ id: 'l1' }], total: 1 });
    expect((await fetchListingPage('ALL', '', 1)).rows).toHaveLength(1);
  });

  it('never invents a total it was not given', async () => {
    // Falling back to the page length is the only honest option here — it is
    // exact whenever the server omits a total AND the page is short, and the
    // register never prints "of N" larger than what it can show.
    stub({ listings: [{ id: 'l1' }] });
    const page = await fetchListingPage('ALL', '', 1);
    expect(page.total).toBe(1);
  });

  it('does not throw on a shape it has never seen', async () => {
    stub({ nonsense: true });
    const page = await fetchListingPage('ALL', '', 1);
    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe('🚨 dead stock is a ranking, not a status', () => {
  it('carries a Dead stock segment alongside the statuses', () => {
    expect(LISTING_SEGMENTS.map((s) => s.value)).toContain('DEAD');
  });

  it('maps the graveyard row without declaring the seller email', async () => {
    // The endpoint selects sellerEmail and the legacy report printed it under
    // every row. The Desk rule is username only, and the Order drawer set the
    // precedent: the data module does not declare the field, so no row
    // component can render it by reaching for what happens to be in the
    // response. Asserting on the mapped object is how that stays true.
    stub([
      {
        id: 'l1',
        referenceNumber: 'GG-9',
        title: 'An old rifle',
        priceCents: 2500_00,
        ageDays: 91.4,
        staleScore: 412000,
        sellerId: 'u1',
        sellerUsername: 'boet',
        sellerEmail: 'boet@example.com',
        categoryName: 'Rifles',
        listingType: 'BUY_NOW',
      },
    ]);
    const [row] = await fetchDeadStock();
    expect(JSON.stringify(row)).not.toContain('boet@example.com');
    expect(JSON.stringify(row)).not.toContain('412000');
    expect(row.seller?.username).toBe('boet');
  });

  it('rounds the age, because a row says "91 days live" not "91.4"', async () => {
    stub([
      {
        id: 'l1',
        referenceNumber: null,
        title: 't',
        priceCents: 1,
        ageDays: 91.4,
        staleScore: 1,
        sellerId: 'u',
        sellerUsername: null,
        sellerEmail: 'x@y.z',
        categoryName: 'c',
        listingType: 'BUY_NOW',
      },
    ]);
    expect((await fetchDeadStock())[0].ageDays).toBe(91);
  });

  it('every row is ACTIVE by definition, which is what makes it dead stock', async () => {
    stub([
      {
        id: 'l1',
        referenceNumber: null,
        title: 't',
        priceCents: null,
        ageDays: 40,
        staleScore: 1,
        sellerId: 'u',
        sellerUsername: null,
        sellerEmail: 'x@y.z',
        categoryName: 'c',
        listingType: 'BUY_NOW',
      },
    ]);
    expect((await fetchDeadStock())[0].status).toBe('ACTIVE');
  });

  it('does not invent a createdAt from an age', async () => {
    // The endpoint returns days, not a date. Deriving one would put a
    // precise-looking timestamp on an approximation.
    stub([
      {
        id: 'l1',
        referenceNumber: null,
        title: 't',
        priceCents: null,
        ageDays: 40,
        staleScore: 1,
        sellerId: 'u',
        sellerUsername: null,
        sellerEmail: 'x@y.z',
        categoryName: 'c',
        listingType: 'BUY_NOW',
      },
    ]);
    expect((await fetchDeadStock())[0].createdAt).toBe('');
  });
});
