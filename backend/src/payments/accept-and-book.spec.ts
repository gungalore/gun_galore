// The accept-and-book seam — `_stampAcceptAndBook`.
//
// On seller-accept we CAS-stamp acceptedAt/dispatchDeadlineAt across the whole
// consolidated group and book ONE carrier shipment on the group's carrier line.
// Two things must hold and are easy to break in a refactor:
//   · the booking is keyed on the CARRIER (shipsWithId ?? self), never on a
//     sibling — booking a sibling declares a second parcel for one shipment;
//   · a LOST claim (count 0 — the row was refunded/disputed/already accepted)
//     stamps nothing, books nothing and notifies nobody.
//
// These three cases arrived with the Daily Deals booking-deferral spec
// (deal-booking-deferral.spec.ts) and are kept here, unchanged, now that Daily
// Deals is gone — they were always assertions about the ORDINARY sale, and
// they are what proves the deal removal left this seam alone.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

// Minimal shape `_stampAcceptAndBook(transactionId, tx)` reads. The private
// method is exercised directly — its caller (acceptTransaction) funnels
// through it verbatim.
type StampTx = {
  id: string;
  shipsWithId: string | null;
  shippingMethod: string | null;
  listing: { title: string };
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
    shipsWithId: null,
    shippingMethod: 'TCG',
    listing: { title: 'Widget' },
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
      // The atomic accept-stamp claim. count>0 → proceeds to book.
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: over.stampedCount ?? 1 }),
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
    {} as never, // peach
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

  // Reach the private stamp core directly (its caller is a thin wrapper).
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

describe('_stampAcceptAndBook — the ordinary accept books immediately', () => {
  it('BOOKS: a standalone line books the courier immediately, keyed on itself', async () => {
    const { shipping, notifications, stamp } = makeService();
    const res = await stamp('TX1', makeTx({ listing: { title: 'Seller item' } }));

    expect(res).not.toBeNull();
    // carrierId = shipsWithId ?? transactionId → itself for a standalone line.
    expect(shipping.bookForTransaction).toHaveBeenCalledTimes(1);
    expect(shipping.bookForTransaction).toHaveBeenCalledWith('TX1');
    // …and the buyer hears "accepted, dispatch within 5 days".
    expect(notifications.saleAcceptedBuyer).toHaveBeenCalledTimes(1);
  });

  it('BOOKS the CARRIER, not the sibling: a consolidated line books shipsWithId', async () => {
    const { shipping, stamp } = makeService();
    // A consolidated sibling — its carrier owns the one parcel/booking.
    await stamp('TX1', makeTx({ shipsWithId: 'CARRIER9', listing: { title: 'x' } }));
    expect(shipping.bookForTransaction).toHaveBeenCalledWith('CARRIER9');
  });

  it('a lost accept-claim (count 0) stamps nothing and books nothing', async () => {
    const { shipping, notifications, stamp } = makeService({ stampedCount: 0 });
    const res = await stamp('TX1', makeTx({ listing: { title: 'Seller item' } }));
    expect(res).toBeNull();
    expect(shipping.bookForTransaction).not.toHaveBeenCalled();
    expect(notifications.saleAcceptedBuyer).not.toHaveBeenCalled();
  });
});
