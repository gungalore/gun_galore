// EXP-E4 — raiseExperienceDispute. A thin analog of raiseDispute for a future-
// dated ON_SITE_SERVICE booking. Asserts:
//   • buyer-only;
//   • allowed while HELD + paid + within (eventEndDate ?? eventDate) + 7d;
//   • NO "must be dispatched first" gate (experiences never dispatch);
//   • atomic CAS HELD→DISPUTED (count===0 aborts) — a DISPUTED row then blocks
//     release/cancel (both require HELD, checked here + in experience-release);
//   • urgent EXPERIENCE_DISPUTE_RAISED AdminAlert;
//   • NO money moves (no refund child minted, no release).
//
// TransactionsService transitively imports meilisearch (ESM-only) — stub it so
// ts-jest doesn't choke (same as the sibling experience specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

const DAY = 24 * 60 * 60 * 1000;

function makeTx(over: Record<string, unknown> = {}) {
  return {
    id: 'TX1',
    sellerId: 'S1',
    buyerId: 'B1',
    listingId: 'L1',
    buyerTotal: 2_537_500,
    orderReference: 'HP000001',
    paidAt: new Date(Date.now() - 5 * DAY),
    paymentStatus: 'HELD',
    shippingMethod: 'ON_SITE_SERVICE',
    adminNote: null,
    // Event is TODAY-ish (yesterday) → well inside the 7d dispute window.
    eventDate: new Date(Date.now() - 1 * DAY),
    eventEndDate: null,
    buyer: { clerkId: 'clerk_b', username: 'buyer' },
    listing: { title: 'Kudu hunt' },
    ...over,
  };
}

function makeService(
  tx: Record<string, unknown>,
  opts: { updateManyCount?: number } = {},
) {
  const updateManyCount = opts.updateManyCount ?? 1;
  const alertsCreated: Array<Record<string, unknown>> = [];
  const childrenCreated: Array<Record<string, unknown>> = [];

  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(tx),
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        childrenCreated.push(args.data);
        return Promise.resolve({ id: 'CHILD' });
      }),
    },
    adminAlert: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        alertsCreated.push(args.data);
        return Promise.resolve({});
      }),
    },
    $transaction: jest.fn(),
  };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };

  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never, // notifications
    {} as never, // stitch
    {} as never, // kyc
    {} as never, // shipping
    tracking as never,
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );
  return { service, prisma, tracking, alertsCreated, childrenCreated };
}

describe('EXP-E4 raiseExperienceDispute', () => {
  it('happy path: atomic HELD→DISPUTED CAS + urgent alert, NO money moves', async () => {
    const { service, prisma, alertsCreated, childrenCreated } = makeService(makeTx());
    const res = await service.raiseExperienceDispute('TX1', 'clerk_b', 'Guide never showed');
    expect(res).toEqual({ disputed: true });

    // CAS requires HELD + ON_SITE_SERVICE (so a DISPUTED/RELEASED row can't flip).
    expect(prisma.transaction.updateMany).toHaveBeenCalledTimes(1);
    const call = prisma.transaction.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: 'TX1',
      paymentStatus: 'HELD',
      shippingMethod: 'ON_SITE_SERVICE',
    });
    expect(call.data).toMatchObject({ paymentStatus: 'DISPUTED' });

    // Urgent admin alert of the right type.
    expect(alertsCreated).toHaveLength(1);
    expect(alertsCreated[0]).toMatchObject({
      type: 'EXPERIENCE_DISPUTE_RAISED',
      referenceId: 'TX1',
      urgent: true,
    });

    // NO money movement: no refund child minted, no release primitive touched.
    expect(childrenCreated).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-buyer', async () => {
    const { service } = makeService(makeTx());
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_someone_else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-experience (wrong shipping method)', async () => {
    const { service } = makeService(makeTx({ shippingMethod: 'PUDO' }));
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unpaid booking', async () => {
    const { service } = makeService(makeTx({ paidAt: null }));
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-HELD (already released/refunded/disputed) booking', async () => {
    const { service, prisma } = makeService(makeTx({ paymentStatus: 'RELEASED' }));
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT require dispatch (no "must be dispatched first" gate)', async () => {
    // dispatchedAt is irrelevant for an experience — the row has none and the
    // dispute still succeeds.
    const { service } = makeService(makeTx({ dispatchedAt: null }));
    const res = await service.raiseExperienceDispute('TX1', 'clerk_b', 'issue');
    expect(res).toEqual({ disputed: true });
  });

  it('rejects a dispute raised past the 7-day post-event window', async () => {
    const { service, prisma } = makeService(
      makeTx({ eventDate: new Date(Date.now() - 10 * DAY), eventEndDate: null }),
    );
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('uses eventEndDate for the window on a multi-day booking', async () => {
    // eventDate 10d ago (would trip a naive check) but eventEndDate 2d ago →
    // still inside (endDate + 7d) → dispute allowed.
    const { service } = makeService(
      makeTx({
        eventDate: new Date(Date.now() - 10 * DAY),
        eventEndDate: new Date(Date.now() - 2 * DAY),
      }),
    );
    const res = await service.raiseExperienceDispute('TX1', 'clerk_b', 'issue');
    expect(res).toEqual({ disputed: true });
  });

  it('aborts when the atomic claim loses the race (CAS count===0)', async () => {
    const { service, alertsCreated } = makeService(makeTx(), { updateManyCount: 0 });
    await expect(
      service.raiseExperienceDispute('TX1', 'clerk_b', 'issue'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No alert when the claim didn't win.
    expect(alertsCreated).toHaveLength(0);
  });
});
