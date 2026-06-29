// SwapFundingService transitively imports transactions.service (for
// PAYMENT_MODE), which pulls ESM-only meilisearch — stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { SwapFundingService } from './swap-funding.service';
import { FeeCalculator } from '../payments/fee.calculator';

function make() {
  const prisma = {
    swap: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'RTX' }) },
    user: { findUnique: jest.fn() },
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
  return { service, prisma, shipping, referenceNumbers, notifications };
}

describe('SwapFundingService.confirmSwapFunding', () => {
  it('locks the swap once BOTH sides are verified', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim this side
      .mockResolvedValueOnce({ count: 1 }); // lock
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      initiatorVerifiedAt: new Date(),
      ownerVerifiedAt: new Date(),
      initiator: { email: 'i@x.co', firstName: 'I', phone: '1' },
      owner: { email: 'o@x.co', firstName: 'O', phone: '2' },
    });
    await service.confirmSwapFunding('S1', 'OWNER');
    // 2nd updateMany is the LOCK transition.
    expect(prisma.swap.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.swap.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'S1', status: 'AWAITING_FUNDING' }),
        data: expect.objectContaining({ status: 'LOCKED' }),
      }),
    );
  });

  it('does NOT lock when only one side is verified', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany.mockResolvedValueOnce({ count: 1 }); // claim only
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      initiatorVerifiedAt: new Date(),
      ownerVerifiedAt: null,
    });
    await service.confirmSwapFunding('S1', 'INITIATOR');
    expect(prisma.swap.updateMany).toHaveBeenCalledTimes(1); // no lock call
  });

  it('is idempotent — an already-verified side is a no-op (claim count 0)', async () => {
    const { service, prisma } = make();
    prisma.swap.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.confirmSwapFunding('S1', 'INITIATOR');
    expect(prisma.swap.findUnique).not.toHaveBeenCalled();
  });
});

describe('SwapFundingService.sweepExpiredFunding', () => {
  it('cancels a lapsed swap, restocks both listings, and refunds the funded side', async () => {
    const { service, prisma } = make();
    prisma.swap.findMany.mockResolvedValue([
      {
        id: 'S1',
        initiatorVerifiedAt: new Date(), // initiator paid
        ownerVerifiedAt: null, // owner didn't
        initiatorRefundedAt: null,
        ownerRefundedAt: null,
        transactions: [
          { id: 'L1', listingId: 'LA' },
          { id: 'L2', listingId: 'LB' },
        ],
      },
    ]);
    prisma.swap.updateMany
      .mockResolvedValueOnce({ count: 1 }) // cancel claim
      .mockResolvedValueOnce({ count: 1 }); // refund idempotency guard
    // createFundingRefund re-reads the swap with amounts + leg listings.
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      initiatorId: 'I',
      ownerId: 'O',
      initiatorFundingAmount: 13_000,
      ownerFundingAmount: 13_000,
      initiatorFundingRef: 'SW000001',
      ownerFundingRef: 'SW000002',
      transactions: [
        { swapRole: 'INITIATOR_GIVES', listingId: 'LA' },
        { swapRole: 'OWNER_GIVES', listingId: 'LB' },
      ],
    });

    await service.sweepExpiredFunding();

    // Cancelled.
    expect(prisma.swap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'S1', status: 'AWAITING_FUNDING' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    // Both listings restocked.
    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['LA', 'LB'] },
          status: 'PAYMENT_PENDING',
        }),
        data: { status: 'ACTIVE' },
      }),
    );
    // The funded (initiator) side gets a synthetic REFUNDED tx for the full amount.
    expect(prisma.transaction.create).toHaveBeenCalledWith(
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

  it('skips when nothing is stale', async () => {
    const { service, prisma } = make();
    prisma.swap.findMany.mockResolvedValue([]);
    await service.sweepExpiredFunding();
    expect(prisma.swap.updateMany).not.toHaveBeenCalled();
  });
});
