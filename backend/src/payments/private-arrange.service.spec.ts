// Phase 4 W2 — Private Arrangement held-funds handover. Funds stay HELD after
// payment; the buyer's "received" releases the payout; either party can dispute.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

function makeService(opts: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
} = { tx: null }) {
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(opts.tx),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    paymentReleasedSeller: jest.fn().mockResolvedValue(undefined),
    privateArrangeDeliveredNotify: jest.fn().mockResolvedValue(undefined),
    privateArrangeBuyerReminder: jest.fn().mockResolvedValue(undefined),
    privateArrangeContactReveal: jest.fn().mockResolvedValue(undefined),
    privateArrangeSellerHandover: jest.fn().mockResolvedValue(undefined),
    privateArrangeDisputed: jest.fn().mockResolvedValue(undefined),
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
  };
  const zoho = {
    createCommissionInvoice: jest.fn().mockResolvedValue(undefined),
    createBuyerInvoice: jest.fn().mockResolvedValue(undefined),
    createShippingCostJournal: jest.fn().mockResolvedValue(undefined),
  };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
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
    zoho as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, notifications, zoho, tracking };
}

const baseTx = {
  id: 'TX1',
  buyerId: 'B',
  sellerId: 'S',
  sellerPayout: 90_000,
  buyerTotal: 100_000,
  shippingMethod: 'PRIVATE_ARRANGE',
  paymentStatus: 'HELD',
  acceptedAt: new Date(),
  privateArrangeAcceptedAt: new Date(),
  privateArrangeDeliveredAt: null,
  privateArrangeReceivedAt: null,
  paidAt: new Date(),
  seller: { email: 's@x.co', firstName: 'Sy', username: 'sy', phone: null },
  listing: { title: 'Scope' },
  buyer: { email: 'b@x.co', firstName: 'Bo', phone: null },
};

describe('TransactionsService — Private Arrangement handover', () => {
  it('buyer "received" releases the payout', async () => {
    const { service, prisma, notifications, zoho } = makeService({
      tx: { ...baseTx, privateArrangeDeliveredAt: new Date() },
    });
    const r = await service.confirmPrivateArrangeReceived('TX1', 'B');
    expect(r).toEqual({ released: true });
    // calls[0] stamps receipt; calls[1] is the HELD/RELEASED claim.
    const claim = prisma.transaction.updateMany.mock.calls[1][0];
    expect(claim.data.paymentStatus).toBe('RELEASED');
    expect(notifications.paymentReleasedSeller).toHaveBeenCalled();
    expect(zoho.createCommissionInvoice).toHaveBeenCalledWith('TX1');
  });

  it('refuses buyer receipt before the seller accepts', async () => {
    const { service } = makeService({
      tx: { ...baseTx, acceptedAt: null, privateArrangeDeliveredAt: new Date() },
    });
    await expect(
      service.confirmPrivateArrangeReceived('TX1', 'B'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('buyer can confirm receipt WITHOUT the seller marking it delivered', async () => {
    const { service, prisma, notifications } = makeService({ tx: { ...baseTx } });

    const r = await service.confirmPrivateArrangeReceived('TX1', 'B');

    expect(r).toEqual({ released: true });
    // The delivered time is stamped from the buyer's confirmation, so the
    // order timeline is complete even though the seller never tapped it.
    const stamp = prisma.transaction.updateMany.mock.calls[0][0];
    expect(stamp.data.privateArrangeDeliveredAt).toEqual(expect.any(Date));
    const claim = prisma.transaction.updateMany.mock.calls[1][0];
    expect(claim.data.paymentStatus).toBe('RELEASED');
    expect(notifications.paymentReleasedSeller).toHaveBeenCalled();
  });

  it('buyer confirming receipt withdraws their own handover dispute', async () => {
    const { service, prisma, notifications } = makeService({
      tx: { ...baseTx, paymentStatus: 'DISPUTED' },
    });

    const r = await service.confirmPrivateArrangeReceived('TX1', 'B');

    expect(r).toEqual({ released: true });
    // The stamp is allowed from DISPUTED, and the release claim itself carries
    // the disputed state — so an accidental report can be undone by the buyer.
    expect(prisma.transaction.updateMany.mock.calls[0][0].where.paymentStatus).toEqual({
      in: ['HELD', 'DISPUTED'],
    });
    expect(prisma.transaction.updateMany.mock.calls[1][0].where.paymentStatus).toEqual({
      in: ['HELD', 'DISPUTED'],
    });
    expect(notifications.paymentReleasedSeller).toHaveBeenCalled();
  });

  it('refuses seller delivery before accepting the sale', async () => {
    const { service } = makeService({ tx: { ...baseTx, acceptedAt: null } });
    await expect(
      service.markPrivateArrangeDelivered('TX1', 'S'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('seller "delivered" stamps the time and notifies the buyer', async () => {
    const { service, prisma, notifications } = makeService({ tx: { ...baseTx } });
    await service.markPrivateArrangeDelivered('TX1', 'S');
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ privateArrangeDeliveredAt: expect.any(Date) }),
      }),
    );
    expect(notifications.privateArrangeDeliveredNotify).toHaveBeenCalled();
  });

  it('rejects a non-seller marking delivered', async () => {
    const { service } = makeService({ tx: { ...baseTx } });
    await expect(
      service.markPrivateArrangeDelivered('TX1', 'B'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dispute from either party freezes to DISPUTED, alerts admin and notifies both', async () => {
    const { service, prisma, notifications, tracking } = makeService({ tx: { ...baseTx } });
    await service.disputePrivateArrange('TX1', 'B', 'not as described');
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('DISPUTED');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'PRIVATE_ARRANGE_DISPUTED' }),
      }),
    );
    // A dispute is a money event for BOTH sides: on 2026-11-24 the seller was
    // never told her payout had been frozen.
    expect(notifications.privateArrangeDisputed).toHaveBeenCalledWith(
      expect.objectContaining({ raisedByBuyer: true, transactionId: 'TX1' }),
    );
    expect(tracking.recordInternal).toHaveBeenCalledWith(
      'TX1',
      'PRIVATE_ARRANGE_DISPUTED',
      expect.anything(),
    );
  });

  it('auto-releases a 5-day-old held private-arrange sale', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.transaction.findMany
      .mockResolvedValueOnce([]) // reminders
      .mockResolvedValueOnce([{ id: 'TX2' }]); // auto-release
    prisma.transaction.findUnique.mockResolvedValue({
      ...baseTx,
      id: 'TX2',
      paidAt: new Date(Date.now() - 6 * 86400_000),
    });

    const r = await service.sweepPrivateArrange();

    expect(r.released).toBe(1);
    expect(prisma.transaction.findMany.mock.calls[1][0].where.acceptedAt).toEqual({
      not: null,
    });
    expect(notifications.paymentReleasedSeller).toHaveBeenCalled();
  });

  it('reminds a silent buyer 24h after delivery', async () => {
    const { service, prisma, notifications } = makeService();
    prisma.transaction.findMany
      .mockResolvedValueOnce([{ id: 'TX3' }]) // reminders
      .mockResolvedValueOnce([]); // auto-release
    prisma.transaction.findUnique.mockResolvedValue({
      ...baseTx,
      id: 'TX3',
      buyer: { email: 'b@x.co', firstName: 'Bo', phone: null },
    });

    const r = await service.sweepPrivateArrange();

    expect(r.reminded).toBe(1);
    expect(notifications.privateArrangeBuyerReminder).toHaveBeenCalled();
  });

  it('refuses to release a non-private-arrange order', async () => {
    const { service } = makeService({ tx: { ...baseTx, shippingMethod: 'COURIER' } });
    await expect(
      service.confirmPrivateArrangeReceived('TX1', 'B'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
