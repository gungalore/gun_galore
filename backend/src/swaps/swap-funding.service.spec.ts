// SwapFundingService transitively imports transactions.service (for
// PAYMENT_MODE), which pulls ESM-only meilisearch — stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { SwapFundingService } from './swap-funding.service';
import { FeeCalculator } from '../payments/fee.calculator';

function make() {
  // The inner interactive-transaction client used by the sweep.
  const txc = {
    swap: { updateMany: jest.fn(), findUnique: jest.fn() },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'RTX' }) },
  };
  const prisma = {
    swap: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'RTX' }) },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (c: typeof txc) => unknown) => fn(txc)),
  };
  const shipping = { quoteForListing: jest.fn() };
  const fees = new FeeCalculator();
  const referenceNumbers = { allocateOrderReference: jest.fn() };
  const notifications = {
    swapFundingReady: jest.fn().mockResolvedValue(undefined),
    swapLocked: jest.fn().mockResolvedValue(undefined),
    swapFundingCancelled: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SwapFundingService(
    prisma as never,
    shipping as never,
    fees as never,
    referenceNumbers as never,
    notifications as never,
  );
  return { service, prisma, txc, notifications };
}

describe('SwapFundingService.confirmSwapFunding', () => {
  it('atomically LOCKs once the second side verifies (both-verified WHERE guard)', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany
      .mockResolvedValueOnce({ count: 1 }) // verify-claim for this side
      .mockResolvedValueOnce({ count: 1 }); // tryLock wins
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      initiator: { email: 'i@x.co', firstName: 'I', phone: '1' },
      owner: { email: 'o@x.co', firstName: 'O', phone: '2' },
    });
    await service.confirmSwapFunding('S1', 'OWNER');
    expect(prisma.swap.updateMany).toHaveBeenCalledTimes(2);
    // The lock is a single conditional write requiring BOTH sides verified.
    expect(prisma.swap.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'S1',
          status: 'AWAITING_FUNDING',
          initiatorVerifiedAt: { not: null },
          ownerVerifiedAt: { not: null },
        }),
        data: expect.objectContaining({ status: 'LOCKED' }),
      }),
    );
  });

  it('does not LOCK when only one side is verified (tryLock matches 0 rows)', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany
      .mockResolvedValueOnce({ count: 1 }) // verify-claim
      .mockResolvedValueOnce({ count: 0 }); // tryLock: other side still null
    await service.confirmSwapFunding('S1', 'INITIATOR');
    expect(prisma.swap.updateMany).toHaveBeenCalledTimes(2); // claim + tryLock attempt
  });

  it('is idempotent — an already-verified side short-circuits before tryLock', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany.mockResolvedValueOnce({ count: 0 }); // claim no-op
    await service.confirmSwapFunding('S1', 'INITIATOR');
    expect(prisma.swap.updateMany).toHaveBeenCalledTimes(1); // no tryLock
  });
});

describe('SwapFundingService.sweepExpiredFunding', () => {
  it('cancels + restocks + reimburses the funded side, all in one transaction', async () => {
    const { service, prisma, txc } = make();
    // 1st findMany = relockFullyFunded (none); 2nd = the stale set.
    prisma.swap.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'S1',
          transactions: [
            { swapRole: 'INITIATOR_GIVES', listingId: 'LA' },
            { swapRole: 'OWNER_GIVES', listingId: 'LB' },
          ],
        },
      ]);
    txc.swap.updateMany
      .mockResolvedValueOnce({ count: 1 }) // cancel claim wins
      .mockResolvedValueOnce({ count: 1 }); // refund idempotency stamp
    // Fresh re-read inside the tx — initiator paid, owner did not.
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I',
      ownerId: 'O',
      initiatorVerifiedAt: new Date(),
      ownerVerifiedAt: null,
      initiatorRefundedAt: null,
      ownerRefundedAt: null,
      initiatorFundingAmount: 13_000,
      ownerFundingAmount: 13_000,
      initiatorFundingRef: 'SW000001',
      ownerFundingRef: 'SW000002',
    });

    await service.sweepExpiredFunding();

    // Cancel claim is guarded on status AND not-both-verified.
    expect(txc.swap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'S1',
          status: 'AWAITING_FUNDING',
          OR: [{ initiatorVerifiedAt: null }, { ownerVerifiedAt: null }],
        }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    // Both listings restocked.
    expect(txc.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['LA', 'LB'] },
          status: 'PAYMENT_PENDING',
        }),
        data: { status: 'ACTIVE' },
      }),
    );
    // Funded (initiator) side reimbursed in full via a synthetic REFUNDED tx.
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          swapId: 'S1',
          buyerId: 'I',
          buyerTotal: 13_000,
          refundedAmount: 13_000,
          paymentStatus: 'REFUNDED',
        }),
      }),
    );
  });

  it('does not refund a side that never verified', async () => {
    const { service, prisma, txc } = make();
    prisma.swap.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'S1', transactions: [{ swapRole: 'INITIATOR_GIVES', listingId: 'LA' }, { swapRole: 'OWNER_GIVES', listingId: 'LB' }] },
      ]);
    txc.swap.updateMany.mockResolvedValue({ count: 1 });
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I', ownerId: 'O',
      initiatorVerifiedAt: null, ownerVerifiedAt: null,
      initiatorRefundedAt: null, ownerRefundedAt: null,
      initiatorFundingAmount: 13_000, ownerFundingAmount: 13_000,
      initiatorFundingRef: 'SW1', ownerFundingRef: 'SW2',
    });
    await service.sweepExpiredFunding();
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('skips when nothing is stale', async () => {
    const { service, prisma } = make();
    prisma.swap.findMany.mockResolvedValue([]); // relock + stale both empty
    await service.sweepExpiredFunding();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
