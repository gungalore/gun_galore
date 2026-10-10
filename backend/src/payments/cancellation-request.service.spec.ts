// Phase 4 rework — a buyer REQUESTs a cancellation. It freezes the order (no
// accept/booking/dispatch/payout), notifies the seller, and raises an admin
// alert. NO money moves here; support resolves it with a fee-retained refund.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';

function makeService(opts: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
}) {
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(opts.tx),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  const notifications = {
    orderCancellationRequested: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TransactionsService(
    prisma as never,
    {} as never, // fees
    notifications as never,
    {} as never, // ozow
    {} as never, // kyc
    {} as never, // shipping
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );
  return { service, prisma, notifications };
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
  cancellationRequestedAt: null,
  paymentStatus: 'HELD',
  shippingMethod: 'DEALER_TRANSFER',
  listing: { id: 'L1', title: 'Scope' },
  buyer: { id: 'B', email: 'b@x.co', firstName: 'Bo', phone: null },
  seller: { email: 's@x.co', firstName: 'Sy', phone: null },
};

describe('TransactionsService.requestCancellation', () => {
  it('freezes the order, notifies the seller and raises an admin alert (no money)', async () => {
    const { service, prisma, notifications } = makeService({ tx: { ...baseTx } });

    await service.requestCancellation('TX1', 'B', 'Changed my mind');

    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.where.cancellationRequestedAt).toBeNull();
    expect(claim.data.cancellationRequestedAt).toBeInstanceOf(Date);
    expect(claim.data.cancellationRequestReason).toBe('Changed my mind');
    expect(notifications.orderCancellationRequested).toHaveBeenCalledTimes(1);
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'CANCELLATION_REQUESTED' }),
      }),
    );
  });

  it('is idempotent when a request already exists', async () => {
    const { service, prisma, notifications } = makeService({
      tx: { ...baseTx, cancellationRequestedAt: new Date() },
    });
    await service.requestCancellation('TX1', 'B', 'again');
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(notifications.orderCancellationRequested).not.toHaveBeenCalled();
  });

  it('rejects a non-owner', async () => {
    const { service } = makeService({ tx: { ...baseTx } });
    await expect(
      service.requestCancellation('TX1', 'SOMEONE', 'mine'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a dispatched order', async () => {
    const { service } = makeService({
      tx: { ...baseTx, dispatchedAt: new Date() },
    });
    await expect(
      service.requestCancellation('TX1', 'B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-HELD order', async () => {
    const { service } = makeService({
      tx: { ...baseTx, paymentStatus: 'RELEASED' },
    });
    await expect(
      service.requestCancellation('TX1', 'B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('surfaces a conflict when the atomic freeze loses the race', async () => {
    const { service } = makeService({ tx: { ...baseTx }, claimCount: 0 });
    await expect(
      service.requestCancellation('TX1', 'B', 'Changed my mind'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a too-short reason', async () => {
    const { service } = makeService({ tx: { ...baseTx } });
    await expect(
      service.requestCancellation('TX1', 'B', 'x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
