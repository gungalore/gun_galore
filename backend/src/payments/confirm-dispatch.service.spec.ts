// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService } from './transactions.service';

function makeService(tx: Record<string, unknown>) {
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(tx),
      update: jest.fn().mockResolvedValue({ ...tx, dispatchedAt: new Date() }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'SELLER' }) },
  };
  const notifications = {
    itemDispatched: jest.fn().mockResolvedValue(undefined),
    firearmHandedToDealerBuyer: jest.fn().mockResolvedValue(undefined),
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
  };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };

  // Positional constructor args: prisma, fees, notifications, ozow, kyc,
  // shipping, tracking, tokens, referenceNumbers, fraudRisk, cloudinary,
  // zohoBooks, wishlistAlerts, saps534.
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    notifications as never,
    {} as never,
    {} as never,
    {} as never,
    tracking as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, notifications, tracking };
}

const baseTx = {
  id: 'TX1',
  sellerId: 'SELLER',
  buyerId: 'BUYER',
  paidAt: new Date(),
  acceptedAt: new Date(),
  dispatchedAt: null,
  rejectedAt: null,
  shippingMethod: 'COURIER',
  listing: { id: 'L1', title: 'Scope', isFirearm: false },
  buyer: {
    id: 'BUYER',
    email: 'b@x.co',
    firstName: 'Bo',
    lastName: 'Buyer',
    phone: '082',
  },
};

describe('TransactionsService.confirmDispatch — courier vs dealer transfer', () => {
  it('COURIER records SELLER_DISPATCHED and sends the courier notification', async () => {
    const { service, tracking, notifications } = makeService({ ...baseTx });
    await service.confirmDispatch('TX1', 'SELLER', { trackingReference: 'AB123' });

    expect(tracking.recordInternal).toHaveBeenCalledWith(
      'TX1',
      'SELLER_DISPATCHED',
    );
    expect(notifications.itemDispatched).toHaveBeenCalled();
    expect(notifications.firearmHandedToDealerBuyer).not.toHaveBeenCalled();
  });

  it('DEALER_TRANSFER records DEALER_HANDOVER_STARTED and never the courier path', async () => {
    const { service, tracking, notifications } = makeService({
      ...baseTx,
      shippingMethod: 'DEALER_TRANSFER',
      listing: { id: 'L1', title: 'Rifle', isFirearm: true },
    });
    await service.confirmDispatch('TX1', 'SELLER', {});

    expect(tracking.recordInternal).toHaveBeenCalledWith(
      'TX1',
      'DEALER_HANDOVER_STARTED',
    );
    expect(tracking.recordInternal).not.toHaveBeenCalledWith(
      'TX1',
      'SELLER_DISPATCHED',
    );
    // The buyer must never be told a courier has a firearm — the courier
    // notification is replaced by the dealer hand-over one.
    expect(notifications.itemDispatched).not.toHaveBeenCalled();
    expect(notifications.firearmHandedToDealerBuyer).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'TX1',
        listingTitle: 'Rifle',
        buyerEmail: 'b@x.co',
      }),
    );
    // The seller's open "new sale / dispatch reminder" rows still resolve.
    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'transaction',
      'TX1',
    );
  });
});
