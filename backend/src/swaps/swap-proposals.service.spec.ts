import { BadRequestException } from '@nestjs/common';
import { SwapProposalsService } from './swap-proposals.service';
import { SwapProposalStatus, SwapRole, ListingStatus, ListingType } from '@prisma/client';

// Build a SwapProposalsService with the minimal mocks each path touches.
// Ctor: (prisma, notifications, contactFilter, actionTokens, kyc).
function makeService(over: {
  reserveCount?: number;
  claimCount?: number;
  proposal?: Record<string, unknown>;
} = {}) {
  // The inner $transaction client — inspectable so we can assert on what
  // convertToSwap wrote.
  const txMock = {
    swapProposal: {
      updateMany: jest
        .fn()
        // 1st call = the claim guard; 2nd = sibling rejection.
        .mockResolvedValueOnce({ count: over.claimCount ?? 1 })
        .mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(
        over.proposal ?? {
          id: 'PR1',
          proposerId: 'P',
          ownerId: 'O',
          listingId: 'L_OWNER',
          offeredListingId: 'L_PROP',
          cashAmount: 5000,
          cashDirection: SwapRole.INITIATOR_GIVES,
          counterCashAmount: null,
          counterCashDirection: null,
        },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    listing: {
      updateMany: jest.fn().mockResolvedValue({ count: over.reserveCount ?? 2 }),
    },
    swap: { create: jest.fn().mockResolvedValue({ id: 'SW1' }) },
    transaction: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    user: { findUnique: jest.fn() },
    listing: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    swapProposal: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'PR1', status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    swap: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'SW1',
        initiatorId: 'P',
        ownerId: 'O',
        initiator: { email: 'p@x.co', firstName: 'P', phone: '1', username: 'pp' },
        owner: { email: 'o@x.co', firstName: 'O', phone: '2', username: 'oo' },
        transactions: [
          { swapRole: SwapRole.INITIATOR_GIVES, listing: { title: 'Prop item' } },
          { swapRole: SwapRole.OWNER_GIVES, listing: { title: 'Owner item' } },
        ],
      }),
    },
  };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    swapAgreed: jest.fn().mockResolvedValue(undefined),
    swapProposalReceived: jest.fn().mockResolvedValue(undefined),
    swapProposalCountered: jest.fn().mockResolvedValue(undefined),
    swapDeclined: jest.fn().mockResolvedValue(undefined),
  };
  const contactFilter = { check: jest.fn().mockResolvedValue({ allowed: true }) };
  const actionTokens = { mint: jest.fn().mockResolvedValue('tok') };
  const kyc = { triggerSellerVerification: jest.fn().mockResolvedValue(undefined) };

  const service = new SwapProposalsService(
    prisma as never,
    notifications as never,
    contactFilter as never,
    actionTokens as never,
    kyc as never,
  );
  return { service, prisma, notifications, kyc, txMock };
}

const activeSwop = (over: Record<string, unknown> = {}) => ({
  id: 'L',
  status: ListingStatus.ACTIVE,
  listingType: ListingType.SWOP,
  isFirearm: false,
  sellerId: 'O',
  seller: { id: 'O' },
  ...over,
});

describe('SwapProposalsService.propose — guards', () => {
  it('rejects swapping a listing for itself', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    await expect(
      service.propose('clerkP', { listingId: 'X', offeredListingId: 'X' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks firearm swaps (gated until a later phase)', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    prisma.listing.findUnique
      .mockResolvedValueOnce(activeSwop({ id: 'L_OWNER', isFirearm: true })) // wanted
      .mockResolvedValueOnce(activeSwop({ id: 'L_PROP', sellerId: 'P' })); // offered
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
      } as never),
    ).rejects.toThrow(/firearm/i);
  });

  it('rejects offering a listing you do not own', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    prisma.listing.findUnique
      .mockResolvedValueOnce(activeSwop({ id: 'L_OWNER' }))
      .mockResolvedValueOnce(activeSwop({ id: 'L_PROP', sellerId: 'SOMEONE_ELSE' }));
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
      } as never),
    ).rejects.toThrow(/own/i);
  });

  it('rejects proposing on your own listing', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    prisma.listing.findUnique
      .mockResolvedValueOnce(activeSwop({ id: 'L_OWNER', sellerId: 'P' }))
      .mockResolvedValueOnce(activeSwop({ id: 'L_PROP', sellerId: 'P' }));
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
      } as never),
    ).rejects.toThrow(/own listing/i);
  });
});

describe('SwapProposalsService.acceptProposal — atomic dual-reserve', () => {
  function loadOwnerOk(prisma: ReturnType<typeof makeService>['prisma']) {
    // loadForOwner read — owner owns the listing, proposal is PENDING.
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'PR1',
      status: SwapProposalStatus.PENDING,
      owner: { clerkId: 'clerkO' },
    });
  }

  it('creates the Swap + two legs with correct seller/buyer + cash payer', async () => {
    const { service, prisma, txMock, kyc } = makeService({ reserveCount: 2 });
    loadOwnerOk(prisma);

    await service.acceptProposal('clerkO', 'PR1');

    // Both listings reserved atomically.
    expect(txMock.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['L_OWNER', 'L_PROP'] },
          status: ListingStatus.ACTIVE,
        }),
        data: { status: ListingStatus.PAYMENT_PENDING },
      }),
    );
    // Swap created with the initiator paying (INITIATOR_GIVES → proposer).
    expect(txMock.swap.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashPayerId: 'P', cashAmount: 5000 }),
      }),
    );
    // Two legs, correctly directed.
    const legs = txMock.transaction.createMany.mock.calls[0][0].data;
    expect(legs).toHaveLength(2);
    const initiatorLeg = legs.find((l: { swapRole: string }) => l.swapRole === SwapRole.INITIATOR_GIVES);
    const ownerLeg = legs.find((l: { swapRole: string }) => l.swapRole === SwapRole.OWNER_GIVES);
    expect(initiatorLeg).toMatchObject({ listingId: 'L_PROP', sellerId: 'P', buyerId: 'O', buyerTotal: 0, sellerPayout: 0 });
    expect(ownerLeg).toMatchObject({ listingId: 'L_OWNER', sellerId: 'O', buyerId: 'P', buyerTotal: 0, sellerPayout: 0 });
    // Both parties KYC-triggered post-commit.
    expect(kyc.triggerSellerVerification).toHaveBeenCalledWith('P');
    expect(kyc.triggerSellerVerification).toHaveBeenCalledWith('O');
  });

  it('rolls back when only one listing could be reserved (double-spend race)', async () => {
    const { service, prisma, txMock } = makeService({ reserveCount: 1 });
    loadOwnerOk(prisma);
    await expect(service.acceptProposal('clerkO', 'PR1')).rejects.toThrow(
      /both items/i,
    );
    // Never created a swap or legs — the throw aborts the transaction.
    expect(txMock.swap.create).not.toHaveBeenCalled();
    expect(txMock.transaction.createMany).not.toHaveBeenCalled();
  });

  it('refuses a second concurrent accept (proposal already claimed)', async () => {
    const { service, prisma, txMock } = makeService({ claimCount: 0 });
    loadOwnerOk(prisma);
    await expect(service.acceptProposal('clerkO', 'PR1')).rejects.toThrow(
      /no longer open/i,
    );
    expect(txMock.listing.updateMany).not.toHaveBeenCalled();
    expect(txMock.swap.create).not.toHaveBeenCalled();
  });

  it('rejects when the caller is not the listing owner', async () => {
    const { service, prisma } = makeService();
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'PR1',
      status: SwapProposalStatus.PENDING,
      owner: { clerkId: 'SOMEONE_ELSE' },
    });
    await expect(service.acceptProposal('clerkO', 'PR1')).rejects.toThrow(
      /access denied/i,
    );
  });
});

describe('SwapProposalsService.expireStale', () => {
  it('marks stale PENDING/COUNTERED proposals EXPIRED + notifies', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.swapProposal.findMany.mockResolvedValue([{ id: 'A' }, { id: 'B' }]);
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'A',
      listing: { title: 'T' },
      listingId: 'L',
      proposer: { email: 'p@x.co', firstName: 'P' },
    });
    await service.expireStale();
    expect(prisma.swapProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['A', 'B'] } },
        data: { status: SwapProposalStatus.EXPIRED },
      }),
    );
  });

  it('no-ops when nothing is stale', async () => {
    const { service, prisma } = makeService();
    prisma.swapProposal.findMany.mockResolvedValue([]);
    await service.expireStale();
    expect(prisma.swapProposal.updateMany).not.toHaveBeenCalled();
  });
});
