// SwapFundingService transitively imports transactions.service (for
// PAYMENT_MODE), which pulls ESM-only meilisearch — stub it.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { SwapFundingService } from './swap-funding.service';
import { FeeCalculator } from '../payments/fee.calculator';

function make() {
  // The inner interactive-transaction client used by the sweep + release.
  const txc = {
    swap: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    transaction: { create: jest.fn().mockResolvedValue({ id: 'RTX' }) },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    swap: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    transaction: {
      create: jest.fn().mockResolvedValue({ id: 'RTX' }),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { swapProofStatus: 'APPROVED' },
          { swapProofStatus: 'APPROVED' },
        ]),
    },
    user: { findUnique: jest.fn() },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (c: typeof txc) => unknown) => fn(txc)),
  };
  const shipping = {
    quoteForListing: jest.fn(),
    bookForTransaction: jest.fn().mockResolvedValue(null), // onSwapLocked (S4)
  };
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
    {
      createCommissionInvoice: jest.fn().mockResolvedValue(undefined), // P0.5 review fix
      createSwapFeeReceipts: jest.fn().mockResolvedValue(undefined), // P1.3 leg-fee receipts
    } as never, // zohoBooks
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
      transactions: [], // onSwapLocked reads legs to book (none in this unit test)
    });
    await service.confirmSwapFunding('S1', 'OWNER');
    // The lock is a single conditional write requiring BOTH sides verified.
    // (Asserted by content, not call-count/last-call: the fire-and-forget
    // onSwapLocked may also fire a later LOCKED→IN_TRANSIT write.)
    expect(prisma.swap.updateMany).toHaveBeenCalledWith(
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

describe('SwapFundingService.ensureFundingSetUp — proof-of-possession gate', () => {
  it('refuses to set up funding until BOTH legs are proof-APPROVED (chokepoint — covers /funding/retry)', async () => {
    const { service, prisma } = make();
    prisma.transaction.findMany.mockResolvedValueOnce([
      { swapProofStatus: 'APPROVED' },
      { swapProofStatus: 'PENDING_REVIEW' },
    ]);
    await expect(service.ensureFundingSetUp('S1')).rejects.toThrow(/photo-verified/i);
    // Threw BEFORE claiming fundingSetUpAt — no half-set-up state.
    expect(prisma.swap.updateMany).not.toHaveBeenCalled();
  });

  it('proceeds past the proof gate once both legs are APPROVED', async () => {
    const { service, prisma } = make();
    prisma.transaction.findMany.mockResolvedValueOnce([
      { swapProofStatus: 'APPROVED' },
      { swapProofStatus: 'APPROVED' },
    ]);
    // claim wins → it gets past the gate and into the claim (then no-op paths
    // are fine for this test; we only assert the gate didn't block).
    prisma.swap.updateMany.mockResolvedValueOnce({ count: 0 }); // already-set-up short-circuit
    await service.ensureFundingSetUp('S1');
    expect(prisma.swap.updateMany).toHaveBeenCalled();
  });
});

describe('SwapFundingService — S5 release / dispute', () => {
  const legs = [
    { id: 'L1', sellerId: 'I', listingId: 'LA', swapRole: 'INITIATOR_GIVES' },
    { id: 'L2', sellerId: 'O', listingId: 'LB', swapRole: 'OWNER_GIVES' },
  ];

  it('force-complete releases the FULL cash to the recipient + both totalSales++', async () => {
    const { service, prisma, txc } = make();
    txc.swap.updateMany.mockResolvedValueOnce({ count: 1 }); // claim wins
    // initiator is the cash payer → owner is the payee.
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I',
      ownerId: 'O',
      cashPayerId: 'I',
      cashAmount: 50_000,
      initiatorFundingRef: 'SW1',
      ownerFundingRef: 'SW2',
      transactions: legs,
    });
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      cashAmount: 50_000,
      cashPayerId: 'I',
      initiatorId: 'I',
      ownerId: 'O',
      initiator: { id: 'I', email: 'i@x.co', firstName: 'I', phone: '1' },
      owner: { id: 'O', email: 'o@x.co', firstName: 'O', phone: '2' },
    });

    await service.adminForceComplete('S1');

    // COMPLETED claim is exactly-once-guarded on cashReleasedAt:null.
    expect(txc.swap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'S1', cashReleasedAt: null }),
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    // Both parties complete a sale.
    expect(txc.user.update).toHaveBeenCalledTimes(2);
    // Settlement pays the PAYEE (owner) the full cash via a RELEASED payout tx.
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          swapId: 'S1',
          sellerId: 'O',
          buyerId: 'I',
          sellerPayout: 50_000,
          buyerTotal: 0,
          paymentStatus: 'RELEASED',
        }),
      }),
    );
  });

  it('force-complete is idempotent — claim lost → no settlement, no sales bump', async () => {
    const { service, txc } = make();
    txc.swap.updateMany.mockResolvedValueOnce({ count: 0 }); // already settled
    await expect(service.adminForceComplete('S1')).rejects.toThrow();
    expect(txc.transaction.create).not.toHaveBeenCalled();
    expect(txc.user.update).not.toHaveBeenCalled();
  });

  it('completes a no-cash swap without any payout tx', async () => {
    const { service, prisma, txc } = make();
    txc.swap.updateMany.mockResolvedValueOnce({ count: 1 });
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I',
      ownerId: 'O',
      cashPayerId: null,
      cashAmount: 0,
      initiatorFundingRef: 'SW1',
      ownerFundingRef: 'SW2',
      transactions: legs,
    });
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      cashAmount: 0,
      cashPayerId: null,
      initiatorId: 'I',
      ownerId: 'O',
      initiator: { id: 'I', email: 'i@x.co', firstName: 'I', phone: '1' },
      owner: { id: 'O', email: 'o@x.co', firstName: 'O', phone: '2' },
    });
    await service.adminForceComplete('S1');
    expect(txc.user.update).toHaveBeenCalledTimes(2);
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('unwind refunds the cash to the PAYER via a REFUNDED tx', async () => {
    const { service, prisma, txc } = make();
    txc.swap.updateMany.mockResolvedValueOnce({ count: 1 });
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I',
      ownerId: 'O',
      cashPayerId: 'I',
      cashAmount: 50_000,
      initiatorFundingRef: 'SW1',
      ownerFundingRef: 'SW2',
      transactions: legs,
    });
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      initiator: { id: 'I', email: 'i@x.co', firstName: 'I' },
      owner: { id: 'O', email: 'o@x.co', firstName: 'O' },
    });
    await service.adminUnwind('S1', 'item not as described');
    expect(txc.swap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerId: 'I', // payer gets the refund
          buyerTotal: 50_000,
          refundedAmount: 50_000,
          sellerPayout: 0,
          paymentStatus: 'REFUNDED',
        }),
      }),
    );
  });

  it('raiseSwapDispute → DISPUTED for a participant, guarded pre-release', async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ id: 'I' });
    prisma.swap.findUnique.mockResolvedValue({ initiatorId: 'I', ownerId: 'O' });
    prisma.swap.updateMany.mockResolvedValue({ count: 1 });
    await service.raiseSwapDispute('clerk', 'S1', 'the scope was cracked on arrival');
    expect(prisma.swap.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'S1',
          status: { in: ['IN_TRANSIT', 'AWAITING_VERIFICATION'] },
          cashReleasedAt: null,
        }),
        data: expect.objectContaining({ status: 'DISPUTED' }),
      }),
    );
  });

  it('raiseSwapDispute rejects a non-participant', async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ id: 'X' });
    prisma.swap.findUnique.mockResolvedValue({ initiatorId: 'I', ownerId: 'O' });
    await expect(
      service.raiseSwapDispute('clerk', 'S1', 'a long enough reason here'),
    ).rejects.toThrow();
  });

  it('auto-release sweep settles AWAITING_VERIFICATION swaps past the window', async () => {
    const { service, prisma, txc } = make();
    prisma.swap.findMany.mockResolvedValueOnce([{ id: 'S1' }]); // one due
    txc.swap.updateMany.mockResolvedValueOnce({ count: 1 });
    txc.swap.findUnique.mockResolvedValue({
      initiatorId: 'I',
      ownerId: 'O',
      cashPayerId: 'O',
      cashAmount: 30_000,
      initiatorFundingRef: 'SW1',
      ownerFundingRef: 'SW2',
      transactions: legs,
    });
    prisma.swap.findUnique.mockResolvedValue({
      id: 'S1',
      cashAmount: 30_000,
      cashPayerId: 'O',
      initiatorId: 'I',
      ownerId: 'O',
      initiator: { id: 'I', email: 'i@x.co', firstName: 'I', phone: '1' },
      owner: { id: 'O', email: 'o@x.co', firstName: 'O', phone: '2' },
    });
    await service.sweepSwapVerification();
    // payer = owner → payee = initiator gets the cash.
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: 'I', sellerPayout: 30_000 }),
      }),
    );
  });
});
