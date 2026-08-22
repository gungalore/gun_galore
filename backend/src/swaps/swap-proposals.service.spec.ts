// SwapProposalsService now imports SwapFundingService, which transitively
// imports transactions.service → ESM-only meilisearch. Stub it (mirrors the
// swap-funding spec).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));
// convertToSwap gates on the module-load PAYMENTS_LIVE const (env unset in
// jest ⇒ false, which would fail every accept test) — force it live here.
// The payments-off behaviour has its own dedicated test via jest.isolateModules.
jest.mock('../payments/transactions.service', () => {
  const actual = jest.requireActual('../payments/transactions.service');
  return { ...actual, PAYMENTS_LIVE: true };
});

import { BadRequestException } from '@nestjs/common';
import { SwapProposalsService } from './swap-proposals.service';
import { FeeCalculator } from '../payments/fee.calculator';
import { SwapProposalStatus, SwapRole, ListingStatus, ListingType } from '@prisma/client';

// Build a SwapProposalsService with the minimal mocks each path touches.
// Ctor: (prisma, notifications, contactFilter, actionTokens, kyc, swapFunding).
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
      count: jest.fn().mockResolvedValue(0),
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
    swapCounterRejected: jest.fn().mockResolvedValue(undefined),
    swapProposalWithdrawn: jest.fn().mockResolvedValue(undefined),
  };
  const contactFilter = { check: jest.fn().mockResolvedValue({ allowed: true }) };
  const actionTokens = { mint: jest.fn().mockResolvedValue('tok') };
  const kyc = { triggerSellerVerification: jest.fn().mockResolvedValue(undefined) };
  const swapFunding = { maybeSetUpFunding: jest.fn().mockResolvedValue(undefined) };

  const service = new SwapProposalsService(
    prisma as never,
    notifications as never,
    contactFilter as never,
    actionTokens as never,
    kyc as never,
    swapFunding as never,
    new FeeCalculator(),
  );
  return { service, prisma, notifications, kyc, txMock };
}

const activeSwop = (over: Record<string, unknown> = {}) => ({
  id: 'L',
  status: ListingStatus.ACTIVE,
  listingType: ListingType.SWOP,
  isFirearm: false,
  shippingMethods: [],
  sellerId: 'O',
  seller: { id: 'O' },
  ...over,
});

describe('SwapProposalsService.propose — guards', () => {
  it('refuses a closed account, and never with the ban wording', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'P',
      isBanned: false,
      accountClosedAt: new Date('2026-08-22'),
    });
    await expect(
      service.propose('clerkP', {
        listingId: 'X',
        offeredListingId: 'Y',
      } as never),
    ).rejects.toThrow(/has been closed/);
    await expect(
      service.propose('clerkP', {
        listingId: 'X',
        offeredListingId: 'Y',
      } as never),
    ).rejects.not.toThrow(/suspended|banned/i);
  });

  it('rejects swapping a listing for itself', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    await expect(
      service.propose('clerkP', { listingId: 'X', offeredListingId: 'X' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('S6: rejects a firearm swap whose firearm side lacks DEALER_TRANSFER', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    prisma.listing.findUnique
      // wanted firearm WITHOUT dealer-transfer in shippingMethods
      .mockResolvedValueOnce(
        activeSwop({ id: 'L_OWNER', isFirearm: true, shippingMethods: [] }),
      )
      .mockResolvedValueOnce(activeSwop({ id: 'L_PROP', sellerId: 'P' }));
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
        firearmAttestation18Plus: true,
      } as never),
    ).rejects.toThrow(/licensed-dealer/i);
  });

  it('S6: rejects a firearm swap without the 18+ attestation', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P', isBanned: false });
    prisma.listing.findUnique
      // wanted firearm WITH dealer-transfer, but no attestation supplied
      .mockResolvedValueOnce(
        activeSwop({
          id: 'L_OWNER',
          isFirearm: true,
          shippingMethods: ['DEALER_TRANSFER'],
        }),
      )
      .mockResolvedValueOnce(activeSwop({ id: 'L_PROP', sellerId: 'P' }));
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
      } as never),
    ).rejects.toThrow(/18|competency/i);
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
  it('atomically flips stale OPEN proposals to EXPIRED (status-guarded) + notifies only rows it flipped', async () => {
    const { service, prisma, notifications } = makeService();
    // One atomic, status-guarded updateMany (no read-then-id-only-write TOCTOU).
    prisma.swapProposal.updateMany.mockResolvedValue({ count: 2 });
    // Re-read of just-flipped rows drives the notifications.
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
        where: expect.objectContaining({
          status: { in: [SwapProposalStatus.PENDING, SwapProposalStatus.COUNTERED] },
          expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: { status: SwapProposalStatus.EXPIRED },
      }),
    );
    expect(notifications.swapDeclined).toHaveBeenCalledTimes(2);
  });

  it('no-ops (no notifications, no re-read) when nothing flipped', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.swapProposal.updateMany.mockResolvedValue({ count: 0 });
    await service.expireStale();
    expect(prisma.swapProposal.findMany).not.toHaveBeenCalled();
    expect(notifications.swapDeclined).not.toHaveBeenCalled();
  });
});

// 2026-07-19 hardening + monetisation — gates, CAS transitions, declared value.
describe('SwapProposalsService — 2026-07-19 gates', () => {
  it('propose: refused at 3 unmet-commitment strikes', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'P',
      isBanned: false,
      auctionStrikes: 3,
    });
    await expect(
      service.propose('clerkP', { listingId: 'A', offeredListingId: 'B' } as never),
    ).rejects.toThrow(/three strikes/i);
  });

  it('propose: non-PRO capped at one open proposal (PRO is not)', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'P',
      isBanned: false,
      auctionStrikes: 0,
      subscriptionTier: 'FREE',
    });
    prisma.swapProposal.count.mockResolvedValue(1);
    await expect(
      service.propose('clerkP', { listingId: 'A', offeredListingId: 'B' } as never),
    ).rejects.toThrow(/upgrade to PRO/i);

    // Same state but PRO — the cap must NOT fire; the next guard (self-swap)
    // proves we got past it.
    prisma.user.findUnique.mockResolvedValue({
      id: 'P',
      isBanned: false,
      auctionStrikes: 0,
      subscriptionTier: 'PRO',
    });
    await expect(
      service.propose('clerkP', { listingId: 'X', offeredListingId: 'X' } as never),
    ).rejects.toThrow(/itself/i);
  });

  it('propose: refused when either listing lacks a declared value', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'P',
      isBanned: false,
      auctionStrikes: 0,
      subscriptionTier: 'PRO',
    });
    prisma.listing.findUnique
      .mockResolvedValueOnce(activeSwop({ id: 'L_OWNER', declaredValueCents: null }))
      .mockResolvedValueOnce(
        activeSwop({ id: 'L_PROP', sellerId: 'P', declaredValueCents: 500_000 }),
      );
    await expect(
      service.propose('clerkP', {
        listingId: 'L_OWNER',
        offeredListingId: 'L_PROP',
      } as never),
    ).rejects.toThrow(/declared value/i);
  });

  it('withdraw: CAS — loses cleanly against a concurrent accept', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P' });
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'PR1',
      status: SwapProposalStatus.PENDING,
      proposer: { clerkId: 'clerkP' },
    });
    prisma.swapProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.withdraw('clerkP', 'PR1')).rejects.toThrow(
      /no longer open/i,
    );
  });

  it('reject: CAS is status-guarded so it cannot relabel a CONVERTED proposal', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'O' });
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'PR1',
      status: SwapProposalStatus.PENDING,
      owner: { clerkId: 'clerkO', auctionStrikes: 0 },
    });
    prisma.swapProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject('clerkO', 'PR1')).rejects.toThrow(/no longer open/i);
    expect(prisma.swapProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: SwapProposalStatus.PENDING }),
      }),
    );
  });

  it('rejectCounter: notifies the owner their counter was declined', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: 'P' });
    prisma.swapProposal.findUnique.mockResolvedValue({
      id: 'PR1',
      status: SwapProposalStatus.COUNTERED,
      proposer: { clerkId: 'clerkP', username: 'pp' },
      owner: { email: 'o@x.co', firstName: 'O' },
      listing: { title: 'T' },
      listingId: 'L',
    });
    prisma.swapProposal.updateMany.mockResolvedValue({ count: 1 });
    await service.rejectCounter('clerkP', 'PR1');
    await new Promise((r) => setTimeout(r, 0));
    expect(notifications.swapCounterRejected).toHaveBeenCalled();
  });
});

// The payments-off gate is a module-load const, so it needs an isolated
// module registry with PAYMENTS_LIVE forced false.
describe('SwapProposalsService — payments-off agreement gate', () => {
  it('refuses to agree a swap while card payments are off', async () => {
    jest.resetModules();
    jest.doMock('../payments/transactions.service', () => {
      const actual = jest.requireActual('../payments/transactions.service');
      return { ...actual, PAYMENTS_LIVE: false };
    });
    const { SwapProposalsService: Svc } = await import('./swap-proposals.service');
    const prisma = {
      swapProposal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'PR1',
          status: SwapProposalStatus.PENDING,
          counterCashAmount: null,
          offeredListingId: 'L_PROP',
          ownerId: 'O',
          owner: { clerkId: 'clerkO', auctionStrikes: 0 },
        }),
      },
      listing: {
        findUnique: jest.fn().mockResolvedValue({ isFirearm: false }),
      },
    };
    const svc = new Svc(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new FeeCalculator(),
    );
    await expect(svc.acceptProposal('clerkO', 'PR1')).rejects.toThrow(
      /card payments launch/i,
    );
    jest.dontMock('../payments/transactions.service');
  });
});
