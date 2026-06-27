// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

function makeService(opts: {
  tx: Record<string, unknown> | null;
  buyer?: { id: string } | null;
  claimCount?: number;
  refundSuccess?: boolean;
}) {
  const refundPayment = jest
    .fn()
    .mockResolvedValue({ success: opts.refundSuccess ?? true, resultCode: 'OK' });

  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(opts.tx),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.buyer === undefined ? { id: 'B' } : opts.buyer),
    },
    listing: { update: jest.fn().mockResolvedValue({}) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
    orderCancelledByBuyer: jest.fn().mockResolvedValue(undefined),
  };
  const tracking = { recordInternal: jest.fn().mockResolvedValue(undefined) };
  const stitch = { refundPayment };

  // Positional constructor args: prisma, fees, notifications, stitch, kyc,
  // shipping, tracking, tokens, referenceNumbers, fraudRisk.
  const service = new TransactionsService(
    prisma as never,
    {} as never,
    notifications as never,
    stitch as never,
    {} as never,
    {} as never,
    tracking as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, notifications, tracking, refundPayment };
}

const baseTx = {
  id: 'TX1',
  buyerId: 'B',
  listingId: 'L1',
  buyerTotal: 100_000,
  paidAt: new Date(),
  acceptedAt: null,
  rejectedAt: null,
  dispatchedAt: null,
  cancelledByBuyerAt: null,
  paymentStatus: 'HELD',
  shippingMethod: 'PUDO',
  peachPaymentId: 'pay_1',
  listing: { id: 'L1', title: 'Scope' },
  buyer: { id: 'B', email: 'b@x.co', firstName: 'Bo', phone: null },
  seller: { email: 's@x.co', firstName: 'Sy', phone: null },
};

describe('TransactionsService.cancelByBuyer', () => {
  it('cancels a paid PUDO order: refunds, relists, notifies both parties', async () => {
    const { service, prisma, notifications, refundPayment } = makeService({
      tx: { ...baseTx },
    });
    await service.cancelByBuyer('TX1', 'clerk_B', 'Changed my mind');

    expect(refundPayment).toHaveBeenCalledWith('pay_1', 100_000);
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('REFUNDED');
    expect(claim.data.cancelledByBuyerAt).toBeInstanceOf(Date);
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE', soldAt: null } }),
    );
    expect(notifications.orderCancelledByBuyer).toHaveBeenCalled();
  });

  it('rejects a non-owner', async () => {
    const { service } = makeService({ tx: { ...baseTx }, buyer: { id: 'OTHER' } });
    await expect(
      service.cancelByBuyer('TX1', 'clerk_X', 'mine'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses PRIVATE_ARRANGE (no funds to return)', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, shippingMethod: 'PRIVATE_ARRANGE' },
    });
    await expect(
      service.cancelByBuyer('TX1', 'clerk_B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('refuses a dispatched order', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, dispatchedAt: new Date() },
    });
    await expect(
      service.cancelByBuyer('TX1', 'clerk_B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('is idempotent when already cancelled', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, cancelledByBuyerAt: new Date() },
    });
    await service.cancelByBuyer('TX1', 'clerk_B', 'Changed my mind');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('rolls back + alerts when the gateway refund fails', async () => {
    const { service, prisma } = makeService({
      tx: { ...baseTx },
      refundSuccess: false,
    });
    await expect(
      service.cancelByBuyer('TX1', 'clerk_B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: 'HELD', cancelledByBuyerAt: null }),
      }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });
});
