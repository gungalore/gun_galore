// DD-F5 (L3) — the sold-out PO trigger fires EXACTLY ONCE.
//
// syncDealSoldOut flips the Deal to SOLD_OUT with a status-filtered updateMany
// (one-shot by construction: the second run matches 0 rows) and must raise the
// supplier purchase order ONLY when that flip actually happened (count > 0).
// If it fired on count = 0 every markPaid re-entry / reconcile sweep would
// re-hit Zoho; if it never fired the supplier is never ordered from on the
// sold-out path. This locks the count>0 gate deterministically (the dummy-run
// covers it only incidentally).
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

function makeService(over: {
  listing?: { status: string; isDealListing: boolean } | null;
  flipCount?: number;
}) {
  const prisma = {
    listing: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          over.listing === undefined
            ? { status: 'SOLD', isDealListing: true }
            : over.listing,
        ),
    },
    deal: {
      updateMany: jest.fn().mockResolvedValue({ count: over.flipCount ?? 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'D1' }),
    },
  };
  const zohoBooks = {
    createDealPurchaseOrder: jest.fn().mockResolvedValue(undefined),
  };

  // 14-arg ctor — mirror deal-booking-deferral.spec.ts exactly. Only prisma(1)
  // and zohoBooks(12) are exercised by syncDealSoldOut.
  const service = new TransactionsService(
    prisma as never,
    {} as never, // fees
    {} as never, // notifications
    {} as never, // stitch
    {} as never, // kyc
    {} as never, // shipping
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    zohoBooks as never,
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );

  const sync = (listingId: string) =>
    (
      service as unknown as {
        syncDealSoldOut: (listingId: string) => Promise<void>;
      }
    ).syncDealSoldOut(listingId);

  return { prisma, zohoBooks, sync };
}

describe('DD-F syncDealSoldOut — supplier PO raised exactly once', () => {
  it('FIRES the PO when the SOLD_OUT flip happens (count > 0)', async () => {
    const { zohoBooks, sync } = makeService({ flipCount: 1 });
    await sync('L1');
    expect(zohoBooks.createDealPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(zohoBooks.createDealPurchaseOrder).toHaveBeenCalledWith('D1');
  });

  it('does NOT fire on a re-run (count 0 — the deal is already SOLD_OUT)', async () => {
    const { zohoBooks, sync } = makeService({ flipCount: 0 });
    await sync('L1');
    expect(zohoBooks.createDealPurchaseOrder).not.toHaveBeenCalled();
  });

  it('no-op for a listing that is not SOLD (nothing flipped, nothing ordered)', async () => {
    const { prisma, zohoBooks, sync } = makeService({
      listing: { status: 'ACTIVE', isDealListing: true },
    });
    await sync('L1');
    expect(prisma.deal.updateMany).not.toHaveBeenCalled();
    expect(zohoBooks.createDealPurchaseOrder).not.toHaveBeenCalled();
  });

  it('no-op for an ordinary (non-deal) SOLD listing', async () => {
    const { prisma, zohoBooks, sync } = makeService({
      listing: { status: 'SOLD', isDealListing: false },
    });
    await sync('L1');
    expect(prisma.deal.updateMany).not.toHaveBeenCalled();
    expect(zohoBooks.createDealPurchaseOrder).not.toHaveBeenCalled();
  });
});
