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
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
  };
  const zoho = {
    createCommissionInvoice: jest.fn().mockResolvedValue(undefined),
    createBuyerInvoice: jest.fn().mockResolvedValue(undefined),
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
    const { service, prisma, notifications, zoho } = makeService({ tx: { ...baseTx } });
    const r = await service.confirmPrivateArrangeReceived('TX1', 'B');
    expect(r).toEqual({ released: true });
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('RELEASED');
    expect(notifications.paymentReleasedSeller).toHaveBeenCalled();
    expect(zoho.createCommissionInvoice).toHaveBeenCalledWith('TX1');
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

  it('dispute from either party freezes to DISPUTED + alerts admin', async () => {
    const { service, prisma } = makeService({ tx: { ...baseTx } });
    await service.disputePrivateArrange('TX1', 'B', 'not as described');
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('DISPUTED');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'PRIVATE_ARRANGE_DISPUTED' }),
      }),
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
