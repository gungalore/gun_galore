// ⚠️ 2026-11 MARKETPLACE audit — lifecycle-sweep regression guards.
//
// Two sweeps could each destroy a live deal:
//  1. reclaimOrphanReservations resurrected a CANCELLED/EXPIRED tracked listing
//     (unconditional listing.update({status:'ACTIVE'})).
//  2. staleListingSweep expired an ACTIVE listing that was mid-sale — a tracked
//     listing stays ACTIVE while a unit is reserved, and an accepted offer or a
//     checkout hold is a buyer mid-payment.
//
// Both are cron passes, so the properties that matter are which rows they
// select and which writes they issue. The service is instantiated on its
// prototype with only the collaborators these two passes touch.
import { TasksService } from './tasks.service';

function makeService() {
  const prisma = {
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
    },
    listing: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((arg: unknown[]) => Promise.all(arg)),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const listings = { removeFromIndex: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    listingStale: jest.fn().mockResolvedValue(undefined),
  };
  const svc = Object.create(TasksService.prototype) as TasksService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    prisma,
    logger,
    listings,
    notifications,
    recordCronRun: jest.fn().mockResolvedValue(undefined),
  });
  return { svc, prisma, logger, listings, notifications };
}

const orphan = (over: Record<string, unknown> = {}) => ({
  id: 'TX1',
  listingId: 'L1',
  quantity: 2,
  listing: { trackInventory: true, listingType: 'BUY_NOW' },
  ...over,
});

describe('TasksService.reclaimOrphanReservations — tracked-inventory guard', () => {
  it('restores stock ONLY through a status=ACTIVE CAS (never resurrects a closed listing)', async () => {
    const { svc, prisma, logger } = makeService();
    prisma.transaction.findMany.mockResolvedValue([orphan()]);

    await svc.reclaimOrphanReservations();

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'ACTIVE' },
      data: {
        quantityAvailable: { increment: 2 },
        quantityReserved: { decrement: 2 },
      },
    });
    // An unconditional update() is exactly the resurrection bug.
    expect(
      (prisma.listing as Record<string, unknown>).update,
    ).toBeUndefined();
    // The dead (never-paid) transaction is still removed.
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Reclaimed orphan reserve-tx TX1/),
    );
  });

  it('leaves the status alone and warns when the tracked listing is no longer ACTIVE', async () => {
    const { svc, prisma, logger } = makeService();
    prisma.transaction.findMany.mockResolvedValue([orphan()]);
    prisma.listing.updateMany.mockResolvedValue({ count: 0 });

    await svc.reclaimOrphanReservations();

    // The guard matched 0 rows → no stock write happened. The transaction is
    // still deleted (it is a dead unpaid reservation) but the listing status is
    // untouched, so a CANCELLED/EXPIRED row can never reappear as ACTIVE.
    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'L1', status: 'ACTIVE' }),
      }),
    );
    expect(prisma.transaction.delete).toHaveBeenCalledWith({
      where: { id: 'TX1' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/no longer ACTIVE/),
    );
  });

  it('keeps the non-tracked P0.2 behaviour (PAYMENT_PENDING → ACTIVE/EXPIRED)', async () => {
    const { svc, prisma } = makeService();
    prisma.transaction.findMany.mockResolvedValue([
      orphan({
        listing: { trackInventory: false, listingType: 'AUCTION' },
      }),
    ]);

    await svc.reclaimOrphanReservations();

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'PAYMENT_PENDING' },
      data: { status: 'EXPIRED' },
    });
    expect(prisma.transaction.delete).toHaveBeenCalled();
  });
});

describe('TasksService.staleListingSweep — never expires a sale in flight', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  function expireWhere(prisma: ReturnType<typeof makeService>['prisma']) {
    return (prisma.listing.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
  }

  it('excludes listings with a live accepted offer, checkout hold or held payment', async () => {
    const { svc, prisma } = makeService();

    await svc.staleListingSweep();

    const where = expireWhere(prisma) as Record<string, any>;
    expect(where).toMatchObject({
      status: 'ACTIVE',
      listingType: { not: 'AUCTION' },
      isDealListing: false,
    });
    // A live accepted offer means the item is promised to a buyer who is paying.
    expect(where.offers).toEqual({
      none: { status: 'ACCEPTED', expiresAt: { gt: expect.any(Date) } },
    });
    // A live checkout hold means a buyer is on the payment page right now.
    expect(where.checkoutHolds).toEqual({
      none: {
        OR: [
          { claimedAt: null, expiresAt: { gt: expect.any(Date) } },
          { claimedAt: { gt: expect.any(Date) } },
        ],
      },
    });
    // A paid/held transaction is a completed sale awaiting dispatch/release.
    expect(where.transactions).toEqual({
      none: {
        paymentStatus: 'HELD',
        rejectedAt: null,
        cancelledByBuyerAt: null,
        OR: [
          { paidAt: { not: null } },
          { gatewayCheckoutId: { not: null } },
        ],
      },
    });
  });

  it('still expires a genuinely stale listing with no live activity', async () => {
    const { svc, prisma, listings, notifications } = makeService();
    prisma.listing.findMany
      .mockResolvedValueOnce([
        {
          id: 'L1',
          title: 'Old scope',
          lastRenewedAt: daysAgo(100),
          seller: { email: 'seller@example.com', firstName: 'Sam' },
        },
      ])
      .mockResolvedValueOnce([]);

    await svc.staleListingSweep();

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    expect(listings.removeFromIndex).toHaveBeenCalledWith('L1');
    expect(notifications.listingStale).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'L1', kind: 'expired' }),
    );
  });
});
