// EXP-E2 — the happy money-OUT path for an experience booking. Covers the three
// lifecycle methods added to TransactionsService that replace the goods
// accept→confirm-delivery→reject machinery for a future-dated ON_SITE_SERVICE
// booking:
//   • acceptExperienceBooking    — outfitter confirms (seller-only CAS, NO release)
//   • confirmExperienceCompleted — buyer confirms after the event (atomic release)
//   • declineExperienceBooking   — outfitter declines (full refund + relist)
//
// Money invariants asserted (the adversarial review checks these):
//   (a) NO release before eventDate;
//   (b) NO double-release (CAS count===0 aborts);
//   (c) DISPUTED blocks release (CAS requires HELD);
//   (d) decline never pays the seller + always reactivates the listing;
//   (e) commission invoice fires once on release;
//   (f) seller-only accept/decline, buyer-only confirm-completed.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

const DAY = 24 * 60 * 60 * 1000;

// A paid, HELD, confirmed-bookable experience transaction. Overridable per test.
function makeTx(over: Record<string, unknown> = {}) {
  return {
    id: 'TX1',
    sellerId: 'S1',
    buyerId: 'B1',
    listingId: 'L1',
    quantity: 1,
    buyerTotal: 2_537_500, // R25,375 (R25k + 1.5% EFT fee)
    orderReference: 'HP000001',
    paidAt: new Date(Date.now() - 40 * DAY),
    paymentStatus: 'HELD',
    shippingMethod: 'ON_SITE_SERVICE',
    bookingConfirmedAt: null,
    bookingDeclinedAt: null,
    eventCompletedConfirmedAt: null,
    // Event was YESTERDAY by default → confirm-completed is allowed.
    eventDate: new Date(Date.now() - 1 * DAY),
    deliveredAt: null,
    buyer: { clerkId: 'clerk_b', email: 'b@x.co', firstName: 'Bo', username: 'buyer' },
    listing: {
      id: 'L1',
      title: 'Kudu hunt',
      isExperience: true,
      trackInventory: false,
      listingType: 'BUY_NOW',
    },
    seller: { email: 's@x.co', firstName: 'Sam', username: 'outfitter' },
    ...over,
  };
}

// Build a service with a prisma mock that records writes. `updateManyCount`
// controls what the atomic CAS returns (1 = claim wins, 0 = row moved).
function makeService(
  tx: Record<string, unknown>,
  opts: { seller?: Record<string, unknown> | null; updateManyCount?: number } = {},
) {
  const seller =
    opts.seller === undefined ? { id: 'S1', clerkId: 'clerk_s' } : opts.seller;
  const updateManyCount = opts.updateManyCount ?? 1;

  const created: Array<Record<string, unknown>> = [];
  const listingUpdates: Array<Record<string, unknown>> = [];
  const userUpdates: Array<Record<string, unknown>> = [];

  const txClient = {
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 'CHILD1', ...args.data });
      }),
      findUnique: jest.fn().mockResolvedValue({ ...tx, paymentStatus: 'RELEASED' }),
    },
    user: {
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        userUpdates.push(args);
        return Promise.resolve({});
      }),
    },
  };

  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(tx),
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      update: jest.fn().mockResolvedValue({ id: 'TX1' }),
    },
    user: {
      // service resolves the seller/buyer by clerkId
      findUnique: jest.fn().mockResolvedValue(seller),
      update: jest.fn().mockResolvedValue({}),
    },
    listing: {
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        listingUpdates.push(args);
        return Promise.resolve({});
      }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (c: typeof txClient) => unknown) => cb(txClient)),
  };

  const zohoBooks = { createCommissionInvoice: jest.fn().mockResolvedValue(undefined) };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    saleAcceptedBuyer: jest.fn().mockResolvedValue(undefined),
    saleRejectedBuyer: jest.fn().mockResolvedValue(undefined),
    paymentReleasedSeller: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    notifications as never,
    {} as never, // stitch
    {} as never, // kyc
    {} as never, // shipping
    tracking as never,
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    zohoBooks as never,
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );
  return {
    service,
    prisma,
    txClient,
    zohoBooks,
    tracking,
    notifications,
    created,
    listingUpdates,
    userUpdates,
  };
}

// ─── acceptExperienceBooking ────────────────────────────────────────────────
describe('EXP-E2 acceptExperienceBooking (outfitter confirms, NO release)', () => {
  it('seller-only CAS: stamps bookingConfirmedAt, never touches paymentStatus', async () => {
    const { service, prisma } = makeService(makeTx());
    await service.acceptExperienceBooking('TX1', 'clerk_s');

    expect(prisma.transaction.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.transaction.updateMany.mock.calls[0][0];
    // CAS where-clause pins HELD + ON_SITE_SERVICE + not-yet-confirmed.
    expect(call.where).toMatchObject({
      id: 'TX1',
      paymentStatus: 'HELD',
      shippingMethod: 'ON_SITE_SERVICE',
      bookingConfirmedAt: null,
    });
    expect(call.data.bookingConfirmedAt).toBeInstanceOf(Date);
    // NO release — paymentStatus is never set here.
    expect(call.data.paymentStatus).toBeUndefined();
  });

  it('rejects a non-seller (only the outfitter can confirm)', async () => {
    // The clerkId resolves to a DIFFERENT user id than tx.sellerId.
    const { service } = makeService(makeTx(), {
      seller: { id: 'SOMEONE_ELSE', clerkId: 'clerk_x' },
    });
    await expect(
      service.acceptExperienceBooking('TX1', 'clerk_x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent — already-confirmed returns without a second CAS', async () => {
    const { service, prisma } = makeService(
      makeTx({ bookingConfirmedAt: new Date() }),
    );
    await service.acceptExperienceBooking('TX1', 'clerk_s');
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when the row is no longer HELD (CAS count===0)', async () => {
    const { service } = makeService(makeTx(), { updateManyCount: 0 });
    await expect(
      service.acceptExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unpaid booking', async () => {
    const { service } = makeService(makeTx({ paidAt: null }));
    await expect(
      service.acceptExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-experience (wrong shipping method)', async () => {
    const { service } = makeService(makeTx({ shippingMethod: 'PUDO' }));
    await expect(
      service.acceptExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── confirmExperienceCompleted ─────────────────────────────────────────────
describe('EXP-E2 confirmExperienceCompleted (buyer confirms → atomic release)', () => {
  it('happy path: atomic HELD→RELEASED CAS, totalSales++, Zoho once', async () => {
    const { service, txClient, zohoBooks, userUpdates } = makeService(makeTx());
    const res = await service.confirmExperienceCompleted('TX1', 'clerk_b');
    expect(res).toEqual({ released: true });

    // Atomic guarded release inside the interactive $transaction.
    expect(txClient.transaction.updateMany).toHaveBeenCalledTimes(1);
    const call = txClient.transaction.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: 'TX1',
      paymentStatus: 'HELD',
      eventCompletedConfirmedAt: null,
    });
    expect(call.data).toMatchObject({ paymentStatus: 'RELEASED' });
    expect(call.data.releasedAt).toBeInstanceOf(Date);
    expect(call.data.eventCompletedConfirmedAt).toBeInstanceOf(Date);

    // totalSales incremented exactly once for the seller.
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0]).toMatchObject({
      where: { id: 'S1' },
      data: { totalSales: { increment: 1 } },
    });
    // (e) commission invoice fires exactly once on release.
    expect(zohoBooks.createCommissionInvoice).toHaveBeenCalledTimes(1);
    expect(zohoBooks.createCommissionInvoice).toHaveBeenCalledWith('TX1');
  });

  it('(a) NO release before the event date', async () => {
    const { service, prisma, zohoBooks } = makeService(
      makeTx({ eventDate: new Date(Date.now() + 3 * DAY) }), // event is in 3 days
    );
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing released, no commission invoice.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(zohoBooks.createCommissionInvoice).not.toHaveBeenCalled();
  });

  it('(c) DISPUTED blocks release — a non-HELD row is refused up front', async () => {
    const { service, prisma } = makeService(makeTx({ paymentStatus: 'DISPUTED' }));
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('(b) NO double-release — CAS count===0 aborts and rolls back', async () => {
    // Row read as HELD but the guarded updateMany matches 0 (concurrent
    // dispute/confirm slipped in between) → the whole $transaction throws.
    const { service, zohoBooks } = makeService(makeTx(), { updateManyCount: 0 });
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(zohoBooks.createCommissionInvoice).not.toHaveBeenCalled();
  });

  it('rejects a second confirm (eventCompletedConfirmedAt already set)', async () => {
    const { service, prisma } = makeService(
      makeTx({ eventCompletedConfirmedAt: new Date() }),
    );
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('(f) rejects a non-buyer (only the buyer can confirm-completed)', async () => {
    const { service } = makeService(
      makeTx({ buyer: { clerkId: 'clerk_b', email: 'b@x.co', firstName: 'Bo' } }),
    );
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_someone_else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-experience (wrong shipping method)', async () => {
    const { service } = makeService(makeTx({ shippingMethod: 'PUDO' }));
    await expect(
      service.confirmExperienceCompleted('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── declineExperienceBooking ───────────────────────────────────────────────
describe('EXP-E2 declineExperienceBooking (outfitter declines → refund + relist)', () => {
  it('(d) full refund + relist + NOT released to the seller', async () => {
    const { service, txClient, created, listingUpdates } = makeService(makeTx());
    await service.declineExperienceBooking('TX1', 'clerk_s', 'Double-booked');

    // Atomic HELD-guarded flip to REFUNDED (never RELEASED).
    expect(txClient.transaction.updateMany).toHaveBeenCalledTimes(1);
    const claim = txClient.transaction.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'TX1', paymentStatus: 'HELD' });
    expect(claim.data).toMatchObject({
      paymentStatus: 'REFUNDED',
      refundedAmount: 2_537_500,
    });
    expect(claim.data.bookingDeclinedAt).toBeInstanceOf(Date);
    expect(claim.data.bookingDeclinedReason).toBe('Double-booked');

    // A synthetic REFUNDED child is minted for the FNB batch: full value to the
    // buyer, sellerPayout 0 (the outfitter is NEVER paid), refundOfId = parent.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      refundOfId: 'TX1',
      buyerId: 'B1',
      sellerId: 'S1',
      buyerTotal: 2_537_500,
      sellerPayout: 0,
      paymentStatus: 'REFUNDED',
    });

    // Listing reactivated (single BUY_NOW → ACTIVE).
    expect(listingUpdates).toHaveLength(1);
    expect(listingUpdates[0]).toMatchObject({ where: { id: 'L1' } });
    expect(listingUpdates[0].data).toMatchObject({ status: 'ACTIVE' });
  });

  it('(f) rejects a non-seller (only the outfitter can decline)', async () => {
    const { service } = makeService(makeTx(), {
      seller: { id: 'SOMEONE_ELSE', clerkId: 'clerk_x' },
    });
    await expect(
      service.declineExperienceBooking('TX1', 'clerk_x', 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent — already-declined returns without minting a second refund', async () => {
    const { service, prisma } = makeService(
      makeTx({ bookingDeclinedAt: new Date() }),
    );
    await service.declineExperienceBooking('TX1', 'clerk_s');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to decline a RELEASED booking (never move money twice)', async () => {
    const { service, prisma } = makeService(makeTx({ paymentStatus: 'RELEASED' }));
    await expect(
      service.declineExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to decline a DISPUTED booking (leave it to the admin path)', async () => {
    const { service, prisma } = makeService(makeTx({ paymentStatus: 'DISPUTED' }));
    await expect(
      service.declineExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aborts when the atomic claim loses the race (CAS count===0)', async () => {
    const { service, listingUpdates } = makeService(makeTx(), {
      updateManyCount: 0,
    });
    await expect(
      service.declineExperienceBooking('TX1', 'clerk_s'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No listing reactivation when the claim didn't win.
    expect(listingUpdates).toHaveLength(0);
  });
});
