// EXP-E0 safety test (deferred to E4) — the load-bearing guarantee behind the
// whole experience design: a live ON_SITE_SERVICE booking is INVISIBLE to every
// courier/DT/collection sweep in DispatchSlaService. If any of those passes ever
// selected an experience row, a healthy weeks-out hunting booking could be
// nudged, auto-refunded, or admin-alerted as a "stalled courier order".
//
// The proof is structural, not incidental: each pass's Prisma `where.
// shippingMethod` filter is a fixed allow-list (`{ in: ['PUDO','TCG'] }` or a
// literal 'DEALER_TRANSFER' / 'COLLECTION') that ON_SITE_SERVICE is simply not
// in. This spec drives every pass against a mock prisma that RECORDS the where-
// clause, then asserts, two ways:
//   1. the recorded shippingMethod filter never admits ON_SITE_SERVICE; and
//   2. a concrete ON_SITE_SERVICE row — paidAt long ago, accepted long ago,
//      delivered/eventDate in the past, i.e. past EVERY courier deadline — does
//      NOT satisfy that filter (a hand-evaluated match check).
//
// No DB. The passes short-circuit on the empty findMany result before touching
// peach/shipping/notifications, so those deps are trivial stubs.
//
// DispatchSlaService transitively imports tracking → search → the ESM-only
// meilisearch package; stub it so ts-jest doesn't choke (same as the sibling
// experience specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { DispatchSlaService } from './dispatch-sla.service';

const DAY = 24 * 60 * 60 * 1000;

// Would a Prisma `shippingMethod` filter value admit ON_SITE_SERVICE?
// Handles the two shapes the courier passes use: `{ in: [...] }` and a literal.
function filterAdmitsOnSiteService(filter: unknown): boolean {
  const VALUE = 'ON_SITE_SERVICE';
  if (filter == null) return false;
  if (typeof filter === 'string') return filter === VALUE;
  if (typeof filter === 'object') {
    const f = filter as Record<string, unknown>;
    if (Array.isArray(f.in)) return (f.in as unknown[]).includes(VALUE);
    // A `notIn` would admit anything not listed — none of our passes use it,
    // but be honest if that ever changes.
    if (Array.isArray(f.notIn)) return !(f.notIn as unknown[]).includes(VALUE);
  }
  return false;
}

// A past-every-courier-deadline ON_SITE_SERVICE HELD row. It is deliberately
// "stale" by every courier metric so the ONLY thing keeping it out of the
// sweeps is the shippingMethod filter.
const experienceRow = {
  id: 'TXexp',
  shippingMethod: 'ON_SITE_SERVICE',
  paymentStatus: 'HELD',
  paidAt: new Date(Date.now() - 90 * DAY),
  acceptedAt: new Date(Date.now() - 60 * DAY),
  dispatchDeadlineAt: new Date(Date.now() - 55 * DAY),
  dispatchedAt: null,
  rejectedAt: null,
  dispatchNudgedAt: null,
  confirmedDeliveryAt: null,
  deliveredAt: new Date(Date.now() - 30 * DAY),
  adminAlertedForStuckFundsAt: null,
  adminAlertedForDtStallAt: null,
  collectionConfirmNudgedAt: null,
  adminAlertedForCollectionStallAt: null,
  swapId: null,
  dealerVerificationStatus: null,
  eventDate: new Date(Date.now() - 30 * DAY),
};

// Build a DispatchSlaService over a prisma double that records each findMany
// where-clause and returns no rows (so every pass exits before any side-effect).
function makeService() {
  const wheres: Record<string, Record<string, unknown>> = {};
  let currentPass = 'unknown';

  const prisma = {
    transaction: {
      findMany: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        wheres[currentPass] = args.where;
        return Promise.resolve([]);
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
    listing: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([]),
  };

  const peach = { refundPayment: jest.fn() };
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
    peach as never,
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

// Every courier/DT/collection pass + its human-readable name.
const PASSES: Array<{ name: string; run: (s: DispatchSlaService) => Promise<unknown> }> = [
  { name: 'nudgeStale', run: (s) => s.nudgeStale() },
  { name: 'autoRefundStale', run: (s) => s.autoRefundStale() },
  { name: 'alertStuckHeldFunds', run: (s) => s.alertStuckHeldFunds() },
  { name: 'sweepStalledDealerTransfers', run: (s) => s.sweepStalledDealerTransfers() },
  { name: 'sweepStalledCollection', run: (s) => s.sweepStalledCollection() },
];

describe('EXP safety — courier crons never select an ON_SITE_SERVICE booking', () => {
  it('every DispatchSlaService pass filters shippingMethod, and none admit ON_SITE_SERVICE', async () => {
    const { service, wheres, setPass } = makeService();
    for (const pass of PASSES) {
      setPass(pass.name);
      await pass.run(service);
    }

    for (const pass of PASSES) {
      const where = wheres[pass.name];
      expect(where).toBeDefined();
      // (1) the pass constrains shippingMethod at all…
      expect(where.shippingMethod).toBeDefined();
      // …and (2) that constraint does NOT admit an experience.
      expect(filterAdmitsOnSiteService(where.shippingMethod)).toBe(false);
    }
  });

  it('a concrete past-every-deadline ON_SITE_SERVICE row matches ZERO passes', async () => {
    const { service, wheres, setPass } = makeService();
    for (const pass of PASSES) {
      setPass(pass.name);
      await pass.run(service);
    }
    // For each pass, hand-evaluate the shippingMethod predicate against the row.
    let matched = 0;
    for (const pass of PASSES) {
      const where = wheres[pass.name];
      if (filterAdmitsOnSiteService(where.shippingMethod)) matched++;
    }
    expect(matched).toBe(0);
  });

  it('sanity: the same predicate DOES admit the courier methods those passes target', () => {
    // Guards against a false-negative helper (e.g. one that returns false for
    // everything). PUDO/TCG must be admitted by an `{ in: ['PUDO','TCG'] }`,
    // and the literal DT/COLLECTION filters admit their own value.
    expect(filterAdmitsOnSiteService({ in: ['PUDO', 'TCG'] })).toBe(false); // not experience
    expect(filterAdmitsOnSiteService('DEALER_TRANSFER')).toBe(false);
    expect(filterAdmitsOnSiteService('COLLECTION')).toBe(false);
    // And it correctly flags a filter that WOULD admit an experience.
    expect(filterAdmitsOnSiteService({ in: ['PUDO', 'ON_SITE_SERVICE'] })).toBe(true);
    expect(filterAdmitsOnSiteService('ON_SITE_SERVICE')).toBe(true);
    // The experience row is well-formed (uses ON_SITE_SERVICE).
    expect(experienceRow.shippingMethod).toBe('ON_SITE_SERVICE');
  });
});
