// EXP-E3 — the CPA-s17 cancellation ENGINE money-out path. Exercises the three
// service methods on TransactionsService:
//   • cancelExperienceByBuyer     — tiered split (full-refund / partial / forfeit)
//   • cancelExperienceByOutfitter — always a full refund (supplier failure)
//   • getExperienceCancelQuote    — preview (no writes)
//
// Money invariants asserted (the adversarial review checks these):
//   • FULL refund (exempt / full tier): parent → REFUNDED, full-value refund
//     child, seller NEVER paid, listing reactivated;
//   • 100% FORFEIT: parent → RELEASED with sellerPayout = outfitterRelease, NO
//     refund child, NO totalSales++, listing NOT reactivated;
//   • PARTIAL: parent → RELEASED (sellerPayout = outfitterRelease) AND a refund
//     child pays the buyer refundCents; listing reactivated;
//   • money conservation: on every branch the sum of what moves == buyerTotal;
//   • double-cancel CAS (count===0 aborts);
//   • can't cancel after the event date;
//   • outfitter cancel == full refund.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

const DAY = 24 * 60 * 60 * 1000;
const fc = new FeeCalculator();
const commission = (retained: number, top = false) =>
  fc.calculateCommission(retained, top);

// A paid, HELD experience booking whose event is in the FUTURE (so it is
// cancellable). daysOut sets how far out the event is → which tier applies.
function makeTx(over: Record<string, unknown> = {}, daysOut = 40) {
  return {
    id: 'TX1',
    sellerId: 'S1',
    buyerId: 'B1',
    listingId: 'L1',
    quantity: 1,
    buyerTotal: 2_500_000, // R25,000 (exact, so % maths is clean in assertions)
    orderReference: 'HP000001',
    paidAt: new Date(Date.now() - 5 * DAY),
    paymentStatus: 'HELD',
    shippingMethod: 'ON_SITE_SERVICE',
    eventDate: new Date(Date.now() + daysOut * DAY),
    cpaCancelTier: null,
    bookingDeclinedAt: null,
    cancelledByBuyerAt: null,
    buyer: {
      id: 'B1',
      clerkId: 'clerk_b',
      email: 'b@x.co',
      firstName: 'Bo',
      username: 'buyer',
      bankAccountHolder: 'Bo Buyer',
      bankAccountNumber: '123',
      bankBranchCode: '250655',
    },
    seller: {
      id: 'S1',
      clerkId: 'clerk_s',
      email: 's@x.co',
      firstName: 'Sam',
      username: 'outfitter',
      sellerTier: 'STANDARD',
    },
    listing: {
      id: 'L1',
      title: 'Kudu hunt',
      trackInventory: false,
      listingType: 'BUY_NOW',
    },
    ...over,
  };
}

function makeService(
  tx: Record<string, unknown>,
  opts: {
    // Who prepareExperienceCancellation resolves for the buyer/seller auth
    // lookups. Both specs resolve by clerkId; default returns the seller row so
    // outfitter auth passes, and the tx.buyer/tx.seller joins carry clerkIds.
    updateManyCount?: number;
    setting?: { value: string } | null;
  } = {},
) {
  const updateManyCount = opts.updateManyCount ?? 1;
  const created: Array<Record<string, unknown>> = [];
  const listingUpdates: Array<Record<string, unknown>> = [];
  const userUpdates: Array<Record<string, unknown>> = [];
  const parentUpdates: Array<Record<string, unknown>> = [];

  const txClient = {
    transaction: {
      updateMany: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        parentUpdates.push(args);
        return Promise.resolve({ count: updateManyCount });
      }),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 'CHILD1', ...args.data });
      }),
      update: jest.fn().mockResolvedValue({ id: 'TX1' }),
      findUnique: jest.fn().mockResolvedValue({ ...tx, refundedAmount: 0 }),
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
      // prepareExperienceCancellation reads the tx with joins; the decline path
      // (outfitter) reads its own tx too. Both use the same makeTx shape.
      findUnique: jest.fn().mockResolvedValue(tx),
      updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      update: jest.fn().mockResolvedValue({ id: 'TX1' }),
    },
    user: {
      // buyer/seller resolved by clerkId — return the seller row (has clerk_s);
      // the buyer auth compares tx.buyer.clerkId directly, so this lookup only
      // matters for the outfitter/decline path (seller by clerkId).
      findUnique: jest.fn().mockResolvedValue({ id: 'S1', clerkId: 'clerk_s' }),
      update: jest.fn().mockResolvedValue({}),
    },
    listing: {
      update: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        listingUpdates.push(args);
        return Promise.resolve({});
      }),
    },
    setting: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.setting === undefined ? null : opts.setting),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (c: typeof txClient) => unknown) => cb(txClient)),
  };

  const zohoBooks = { createCommissionInvoice: jest.fn().mockResolvedValue(undefined) };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    saleRejectedBuyer: jest.fn().mockResolvedValue(undefined),
    paymentReleasedSeller: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TransactionsService(
    prisma as never,
    fc as never,
    notifications as never,
    {} as never, // peach
    {} as never, // kyc
    { cancelForTransaction: jest.fn() } as never, // shipping
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
    parentUpdates,
  };
}

// ─── cancelExperienceByBuyer ─────────────────────────────────────────────────
describe('EXP-E3 cancelExperienceByBuyer — tiered split', () => {
  it('FULL REFUND (>=60d? no — exempt DEATH): parent REFUNDED + full-value child, seller NOT paid, listing reactivated', async () => {
    // Event 3 days out (would be 100% forfeit) but DEATH exempt → full refund.
    const T = 2_500_000;
    const { service, created, listingUpdates, userUpdates, parentUpdates } =
      makeService(makeTx({}, 3));
    const res = await service.cancelExperienceByBuyer('TX1', 'clerk_b', 'DEATH');
    expect(res.outcome).toBe('FULL_REFUND');
    expect(res.refundCents).toBe(T);

    // Parent flip: HELD-guarded → REFUNDED, full refundedAmount, seller untouched.
    const claim = parentUpdates[0];
    expect(claim.where).toMatchObject({ id: 'TX1', paymentStatus: 'HELD' });
    expect(claim.data).toMatchObject({
      paymentStatus: 'REFUNDED',
      refundedAmount: T,
    });
    expect((claim.data as Record<string, unknown>).releasedAt).toBeNull();
    // A full-value refund child was minted; seller NEVER paid (no user increment).
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      refundOfId: 'TX1',
      buyerTotal: T,
      sellerPayout: 0,
      paymentStatus: 'REFUNDED',
    });
    expect(userUpdates).toHaveLength(0); // NO totalSales++ on a cancel
    // Listing reactivated.
    expect(listingUpdates).toHaveLength(1);
    expect(listingUpdates[0].data).toMatchObject({ status: 'ACTIVE' });
    // Conservation: refund == buyerTotal.
    expect(res.refundCents + res.outfitterReleaseCents + res.ggRetainedCents).toBe(T);
  });

  it('PARTIAL (20d = 50%): parent RELEASED with sellerPayout=outfitterRelease + refund child; listing reactivated; money conserves', async () => {
    const T = 2_500_000;
    const retained = Math.round(T * 0.5);
    const ggComm = commission(retained);
    const outfitter = retained - ggComm;
    const refund = T - retained;

    const { service, created, listingUpdates, userUpdates, parentUpdates, zohoBooks } =
      makeService(makeTx({}, 20));
    const res = await service.cancelExperienceByBuyer('TX1', 'clerk_b');
    expect(res.outcome).toBe('PARTIAL');
    expect(res.refundCents).toBe(refund);
    expect(res.outfitterReleaseCents).toBe(outfitter);
    expect(res.ggRetainedCents).toBe(ggComm);

    // Parent → RELEASED, sellerPayout recomputed to the outfitter's slice,
    // commissionZar to GG's retained, cpaCancelTier recorded, refundedAmount set.
    const claim = parentUpdates[0];
    expect(claim.where).toMatchObject({ id: 'TX1', paymentStatus: 'HELD' });
    expect(claim.data).toMatchObject({
      paymentStatus: 'RELEASED',
      // GROSS sellerPayout = outfitter + refund. The FNB payout batch pays the
      // seller `sellerPayout − Σ(refund children)`, so the outfitter NETS
      // `outfitter`. Storing `outfitter` here would short the outfitter by
      // `refund` (GG silently over-retaining it) — the E3 review-fix.
      sellerPayout: outfitter + refund,
      commissionZar: ggComm,
      refundedAmount: refund,
    });
    expect((claim.data as Record<string, unknown>).cpaCancelTier).toEqual(
      expect.stringContaining('50%'),
    );
    expect((claim.data as Record<string, unknown>).releasedAt).toBeInstanceOf(Date);

    // A refund child pays the buyer their slice; seller NOT double-credited.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      refundOfId: 'TX1',
      buyerTotal: refund,
      sellerPayout: 0,
      paymentStatus: 'REFUNDED',
    });
    // NET payout the outfitter actually receives = sellerPayout − refund child.
    // This is the load-bearing assertion the original test missed.
    expect(
      ((claim.data as Record<string, unknown>).sellerPayout as number) -
        (created[0].buyerTotal as number),
    ).toBe(outfitter);
    expect(userUpdates).toHaveLength(0); // no totalSales++
    // Commission invoice fires (outfitter is being paid the retained slice).
    expect(zohoBooks.createCommissionInvoice).toHaveBeenCalledWith('TX1');
    // Listing reactivated (date freed on a partial).
    expect(listingUpdates).toHaveLength(1);
    expect(listingUpdates[0].data).toMatchObject({ status: 'ACTIVE' });
    // Conservation.
    expect(res.refundCents + res.outfitterReleaseCents + res.ggRetainedCents).toBe(T);
  });

  it('100% FORFEIT (3d): parent RELEASED (sellerPayout=outfitterRelease), NO refund child, listing NOT reactivated', async () => {
    const T = 2_500_000;
    const ggComm = commission(T);
    const outfitter = T - ggComm;

    const { service, created, listingUpdates, parentUpdates, zohoBooks } = makeService(
      makeTx({}, 3),
    );
    const res = await service.cancelExperienceByBuyer('TX1', 'clerk_b');
    expect(res.outcome).toBe('FORFEIT');
    expect(res.refundCents).toBe(0);
    expect(res.outfitterReleaseCents).toBe(outfitter);
    expect(res.ggRetainedCents).toBe(ggComm);

    const claim = parentUpdates[0];
    expect(claim.data).toMatchObject({
      paymentStatus: 'RELEASED',
      sellerPayout: outfitter,
      commissionZar: ggComm,
      refundedAmount: 0,
    });
    // NO refund child on a 100% forfeit.
    expect(created).toHaveLength(0);
    // Listing NOT reactivated — the date was consumed (stays SOLD).
    expect(listingUpdates).toHaveLength(0);
    expect(zohoBooks.createCommissionInvoice).toHaveBeenCalledWith('TX1');
    // Conservation.
    expect(res.refundCents + res.outfitterReleaseCents + res.ggRetainedCents).toBe(T);
  });

  it('>=60d admin-fee tier: partial refund minus R250, R250 is 100% GG (outfitter 0)', async () => {
    const T = 2_500_000;
    const { service, created, parentUpdates } = makeService(makeTx({}, 90));
    const res = await service.cancelExperienceByBuyer('TX1', 'clerk_b');
    expect(res.outcome).toBe('PARTIAL');
    expect(res.ggRetainedCents).toBe(25_000); // R250
    expect(res.outfitterReleaseCents).toBe(0);
    expect(res.refundCents).toBe(T - 25_000);
    const claim = parentUpdates[0];
    expect((claim.data as Record<string, unknown>).cpaAdminFeeCents).toBe(25_000);
    // GROSS sellerPayout = outfitter(0) + refund(T−R250). The batch docks the
    // refund child, so the outfitter NETS 0 (R250 tier → outfitter gets nothing).
    expect((claim.data as Record<string, unknown>).sellerPayout).toBe(T - 25_000);
    // Refund child pays back everything but the R250 fee.
    expect(created[0]).toMatchObject({ buyerTotal: T - 25_000 });
    // NET outfitter payout = sellerPayout − refund child = 0.
    expect(
      ((claim.data as Record<string, unknown>).sellerPayout as number) -
        (created[0].buyerTotal as number),
    ).toBe(0);
    expect(res.refundCents + res.outfitterReleaseCents + res.ggRetainedCents).toBe(T);
  });

  it('double-cancel: CAS count===0 aborts, no child, no listing change', async () => {
    const { service, created, listingUpdates } = makeService(makeTx({}, 20), {
      updateManyCount: 0,
    });
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
    expect(listingUpdates).toHaveLength(0);
  });

  it('rejects a second cancel (cpaCancelTier already set)', async () => {
    const { service, prisma } = makeService(makeTx({ cpaCancelTier: '30–59 days — 20%' }, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("can't cancel after the event date (past event → dispute path)", async () => {
    const { service, prisma } = makeService(makeTx({}, -1)); // event was yesterday
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-buyer (only the buyer can cancel)', async () => {
    const { service } = makeService(makeTx({}, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_someone_else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-HELD booking (DISPUTED/RELEASED refused)', async () => {
    const { service, prisma } = makeService(makeTx({ paymentStatus: 'DISPUTED' }, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects SUPPLIER_FAILURE as a buyer reason (that is the outfitter path)', async () => {
    const { service } = makeService(makeTx({}, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b', 'SUPPLIER_FAILURE'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid exempt reason', async () => {
    const { service } = makeService(makeTx({}, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b', 'WEATHER'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a non-experience booking is refused', async () => {
    const { service } = makeService(makeTx({ shippingMethod: 'PUDO' }, 20));
    await expect(
      service.cancelExperienceByBuyer('TX1', 'clerk_b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── cancelExperienceByOutfitter ─────────────────────────────────────────────
describe('EXP-E3 cancelExperienceByOutfitter — always a full refund', () => {
  it('full refund + relist + seller NOT paid (delegates to decline path)', async () => {
    const T = 2_500_000;
    const { service, created, listingUpdates, parentUpdates } = makeService(
      makeTx({}, 20),
    );
    await service.cancelExperienceByOutfitter('TX1', 'clerk_s', 'Injured PH');
    // decline path: HELD→REFUNDED, full refundedAmount, full-value refund child.
    const claim = parentUpdates[0];
    expect(claim.data).toMatchObject({
      paymentStatus: 'REFUNDED',
      refundedAmount: T,
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ buyerTotal: T, sellerPayout: 0 });
    expect(listingUpdates[0].data).toMatchObject({ status: 'ACTIVE' });
  });

  it('rejects a non-seller', async () => {
    const { service, prisma } = makeService(makeTx({}, 20));
    // decline resolves the seller by clerkId; make that lookup a different user.
    prisma.user.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'SOMEONE_ELSE', clerkId: 'clerk_x' });
    await expect(
      service.cancelExperienceByOutfitter('TX1', 'clerk_x', 'nope'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─── getExperienceCancelQuote ────────────────────────────────────────────────
describe('EXP-E3 getExperienceCancelQuote — preview, NO writes', () => {
  it('returns the computed split + tier label with no DB writes', async () => {
    const T = 2_500_000;
    const retained = Math.round(T * 0.5);
    const { service, prisma, created, parentUpdates, listingUpdates } = makeService(
      makeTx({}, 20),
    );
    const q = await service.getExperienceCancelQuote('TX1', 'clerk_b');
    expect(q.refundCents).toBe(T - retained);
    expect(q.retainedCents).toBe(retained);
    expect(q.tierLabel).toEqual(expect.stringContaining('50%'));
    expect(q.summary).toBeDefined();
    // Absolutely no writes for a preview.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(parentUpdates).toHaveLength(0);
    expect(listingUpdates).toHaveLength(0);
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('quote for a >=60d cancel shows the R250 admin fee', async () => {
    const { service } = makeService(makeTx({}, 90));
    const q = await service.getExperienceCancelQuote('TX1', 'clerk_b');
    expect(q.adminFeeCents).toBe(25_000);
    expect(q.ggRetainedCents).toBe(25_000);
    expect(q.outfitterReleaseCents).toBe(0);
  });

  it('quote honours an exempt reason (full refund preview)', async () => {
    const T = 2_500_000;
    const { service } = makeService(makeTx({}, 3));
    const q = await service.getExperienceCancelQuote('TX1', 'clerk_b', 'HOSPITALISATION');
    expect(q.refundCents).toBe(T);
    expect(q.retainedCents).toBe(0);
    expect(q.exemptReason).toBe('HOSPITALISATION');
  });
});
