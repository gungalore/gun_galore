// DD-F safety test — a house deal (Listing.isDealListing) DEFERS its courier
// booking to the operator's "Stock ready" tap, so it legitimately sits
// accepted + HELD + undispatched during its whole ships-in window (default
// 3–7 days) — well past the accept+5d dispatch clock. The two DispatchSla
// passes that key off that clock — nudgeStale (nudges the seller) and
// autoRefundStale (REFUNDS the buyer) — must therefore EXCLUDE deal listings.
// If autoRefundStale ever selected a deal it would refund a paid, in-flight
// buyer at day 5 while the supplier PO (cut at sold-out) is already live —
// buyer-money-loss + orphaned PO. The guarantee is structural: both passes add
// `where.listing.isDealListing: false`. Crucially a deal ships TCG, which IS in
// the shippingMethod allow-list, so the listing filter is the ONLY thing that
// keeps deals out — this spec proves it stays in.
//
// No DB: each pass short-circuits on the empty findMany before any side-effect,
// so the deps are trivial stubs (same shape as the sibling experience spec).
// DispatchSlaService transitively pulls ESM-only meilisearch — stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { DispatchSlaService } from './dispatch-sla.service';

// Does a recorded Prisma where-clause exclude house-deal listings?
function whereExcludesDeals(
  where: Record<string, unknown> | undefined,
): boolean {
  const listing = where?.listing as { isDealListing?: unknown } | undefined;
  return !!listing && listing.isDealListing === false;
}

// Build a DispatchSlaService over a prisma double that records each findMany
// where-clause and returns no rows (so every pass exits before any side-effect).
function makeService() {
  const wheres: Record<string, Record<string, unknown>> = {};
  let currentPass = 'unknown';

  const prisma = {
    transaction: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) => {
          wheres[currentPass] = args.where;
          return Promise.resolve([]);
        }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    user: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    listing: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([]),
  };

  const stitch = { refundPayment: jest.fn() };
  const notifications = {
    dispatchNudgeSeller: jest.fn(),
    dealerTransferStallNudgeSeller: jest.fn(),
    collectionConfirmNudgeBuyer: jest.fn(),
    orderAutoRefunded: jest.fn(),
  };
  const tracking = { recordInternal: jest.fn() };
  const shipping = { cancelForTransaction: jest.fn() };

  const service = new DispatchSlaService(
    prisma as never,
    stitch as never,
    notifications as never,
    tracking as never,
    shipping as never,
  );

  return {
    service,
    wheres,
    setPass: (name: string) => {
      currentPass = name;
    },
  };
}

// The two passes that key off the accept+5d dispatch clock — the ones a
// deferred deal would wrongly match (it IS TCG + accepted + HELD + undispatched).
const CLOCK_PASSES: Array<{
  name: string;
  run: (s: DispatchSlaService) => Promise<unknown>;
}> = [
  { name: 'nudgeStale', run: (s) => s.nudgeStale() },
  { name: 'autoRefundStale', run: (s) => s.autoRefundStale() },
];

describe('DD-F safety — dispatch-clock crons never select a deferred house deal', () => {
  it('nudgeStale and autoRefundStale both exclude isDealListing rows', async () => {
    const { service, wheres, setPass } = makeService();
    for (const p of CLOCK_PASSES) {
      setPass(p.name);
      await p.run(service);
    }

    for (const p of CLOCK_PASSES) {
      const where = wheres[p.name];
      expect(where).toBeDefined();
      // Still targets the TCG/PUDO courier methods — a deal IS TCG, so this
      // filter alone does NOT keep deals out…
      expect(where.shippingMethod).toEqual({ in: ['PUDO', 'TCG'] });
      // …the listing filter is what excludes them. This is the money guard.
      expect(whereExcludesDeals(where)).toBe(true);
    }
  });

  it('sanity: the helper only passes on an explicit isDealListing:false filter', () => {
    expect(whereExcludesDeals({ listing: { isDealListing: false } })).toBe(true);
    // A missing listing filter (the pre-fix regression) must read as "leaks deals in".
    expect(whereExcludesDeals({})).toBe(false);
    expect(whereExcludesDeals({ listing: {} })).toBe(false);
    expect(whereExcludesDeals({ listing: { isDealListing: true } })).toBe(false);
    expect(whereExcludesDeals(undefined)).toBe(false);
  });
});
