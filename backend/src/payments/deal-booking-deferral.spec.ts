// DD-F3 — booking DEFERRAL at the accept-and-book seam.
//
// A house deal (Listing.isDealListing) is sell-first / buy-after: GG holds no
// stock at accept time and the courier collects from the SUPPLIER warehouse
// only once the operator taps "Stock ready" (DealsService.markStockReadyAndBook
// fires bookForTransaction later). So `_stampAcceptAndBook` must NOT call
// shipping.bookForTransaction for a deal line, while an ORDINARY sale must book
// immediately exactly as before. This locks that branch (transactions.service
// :1657-1665) so a refactor can't silently start double-booking (accept +
// stock-ready) or, worse, courier-book a deal from GG's non-existent address.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

// Minimal shape `_stampAcceptAndBook(transactionId, tx)` reads. The private
// method is exercised directly (its two public callers — acceptTransaction and
// maybeAutoAcceptHouseDeal — funnel through it verbatim), keyed on the one
// field under test: tx.listing.isDealListing.
type StampTx = {
  id: string;
  listingId: string;
  shipsWithId: string | null;
  shippingMethod: string | null;
  listing: { title: string; isDealListing: boolean };
  buyer: {
    email: string;
    firstName: string | null;
    phone: string | null;
    username: string | null;
  };
};

function makeTx(over: Partial<StampTx> = {}): StampTx {
  return {
    id: 'TX1',
    listingId: 'L1',
    shipsWithId: null,
    shippingMethod: 'TCG',
    listing: { title: 'Widget', isDealListing: false },
    buyer: {
      email: 'b@x.co',
      firstName: 'Bo',
      phone: '0830000000',
      username: 'bob',
    },
    ...over,
  };
}

function makeService(over: { stampedCount?: number } = {}) {
  const prisma = {
    transaction: {
      // The atomic accept-stamp claim. count>0 → proceeds to (defer/)book.
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: over.stampedCount ?? 1 }),
    },
    deal: {
      // Only read on the deal branch (ships-in window for the buyer notice).
      findUnique: jest
        .fn()
        .mockResolvedValue({ shipsInDaysMin: 3, shipsInDaysMax: 7 }),
    },
  };
  const shipping = { bookForTransaction: jest.fn().mockResolvedValue(null) };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    saleAcceptedBuyer: jest.fn().mockResolvedValue(undefined),
  };

  // 14-arg ctor — mirror the order in experience-cancel.spec.ts exactly. Only
  // prisma(1), notifications(3), shipping(6), tracking(7) are exercised by
  // _stampAcceptAndBook; the rest are inert stubs.
  const service = new TransactionsService(
    prisma as never,
    {} as never, // fees
    notifications as never,
    {} as never, // stitch
    {} as never, // kyc
    shipping as never,
    tracking as never,
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );

  // Reach the private stamp core directly (public callers are thin wrappers).
  const stamp = (transactionId: string, tx: StampTx) =>
    (
      service as unknown as {
        _stampAcceptAndBook: (
          transactionId: string,
          tx: StampTx,
        ) => Promise<{ acceptedAt: Date; dispatchDeadlineAt: Date } | null>;
      }
    )._stampAcceptAndBook(transactionId, tx);

  return { service, prisma, shipping, tracking, notifications, stamp };
}

describe('DD-F3 _stampAcceptAndBook — deal booking deferral', () => {
  it('DEFERS: a deal line (isDealListing) does NOT book the courier at accept', async () => {
    const { shipping, notifications, stamp } = makeService();
    const res = await stamp('TX1', makeTx({ listing: { title: 'Deal item', isDealListing: true } }));

    // Stamped (acceptedAt/dispatchDeadlineAt returned) but NO booking — that is
    // deferred to markStockReadyAndBook.
    expect(res).not.toBeNull();
    expect(shipping.bookForTransaction).not.toHaveBeenCalled();
    // Buyer is still notified their deal is accepted.
    expect(notifications.saleAcceptedBuyer).toHaveBeenCalledTimes(1);
  });

  it('BOOKS: an ordinary (non-deal) line books the courier immediately, keyed on itself', async () => {
    const { shipping, stamp } = makeService();
    const res = await stamp('TX1', makeTx({ listing: { title: 'Seller item', isDealListing: false } }));

    expect(res).not.toBeNull();
    // carrierId = shipsWithId ?? transactionId → itself for a standalone line.
    expect(shipping.bookForTransaction).toHaveBeenCalledTimes(1);
    expect(shipping.bookForTransaction).toHaveBeenCalledWith('TX1');
  });

  it('BOOKS the CARRIER, not the sibling: a consolidated non-deal line books shipsWithId', async () => {
    const { shipping, stamp } = makeService();
    // A consolidated sibling — its carrier owns the one parcel/booking.
    await stamp('TX1', makeTx({ shipsWithId: 'CARRIER9', listing: { title: 'x', isDealListing: false } }));
    expect(shipping.bookForTransaction).toHaveBeenCalledWith('CARRIER9');
  });

  it('does NOT read the deal ships-in window for a non-deal line', async () => {
    const { prisma, stamp } = makeService();
    await stamp('TX1', makeTx({ listing: { title: 'x', isDealListing: false } }));
    expect(prisma.deal.findUnique).not.toHaveBeenCalled();
  });

  it('a lost accept-claim (count 0) stamps nothing and books nothing', async () => {
    const { shipping, notifications, stamp } = makeService({ stampedCount: 0 });
    const res = await stamp('TX1', makeTx({ listing: { title: 'Seller item', isDealListing: false } }));
    expect(res).toBeNull();
    expect(shipping.bookForTransaction).not.toHaveBeenCalled();
    expect(notifications.saleAcceptedBuyer).not.toHaveBeenCalled();
  });
});
