// meilisearch is ESM and breaks ts-jest if imported for real (AdminService
// → ListingsService → SearchService pulls it in transitively).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

// Focused money-path tests for AdminService.refundTransaction — the
// partial-refund accounting + atomic over-refund guard. We construct the
// service with hand-mocked deps (no Nest DI) and assert on the exact
// gateway amount, the refundedAmount increment, and when the order flips
// to REFUNDED / fires the Zoho credit note.

function makeService(overrides: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
  refundSuccess?: boolean;
}) {
  const refundPayment = jest
    .fn()
    .mockResolvedValue({ success: overrides.refundSuccess ?? true, resultCode: 'OK' });

  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(overrides.tx),
      updateMany: jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    adminAlert: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const notifications = {
    refundIssuedBuyer: jest.fn().mockResolvedValue(undefined),
    resolveByEntity: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const zohoBooks = { createCommissionCreditNote: jest.fn().mockResolvedValue(undefined) };
  const stitch = { refundPayment };

  const transactions = { cancelBookedShipment: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    prisma as never,
    notifications as never,
    {} as never, // listings — unused by refund
    audit as never,
    zohoBooks as never,
    stitch as never,
    transactions as never, // P5.2 — cancels booked shipment on full refund
  );
  return { service, prisma, notifications, audit, zohoBooks, refundPayment, transactions };
}

const baseTx = {
  id: 'TX1',
  paymentStatus: 'HELD',
  buyerTotal: 100_000, // R1 000
  refundedAmount: 0,
  peachPaymentId: 'pay_123',
  listing: { title: 'Scope' },
  buyer: { email: 'b@x.co', firstName: 'Bo', lastName: 'B', phone: null },
};

describe('AdminService.refundTransaction', () => {
  it('partial refund: refunds the typed amount, keeps the order open, no credit note', async () => {
    const { service, prisma, zohoBooks, notifications, refundPayment } = makeService({
      tx: { ...baseTx },
    });
    await service.refundTransaction('TX1', 'admin1', 'partial damage', 30_000);

    // Gateway charged exactly the partial amount
    expect(refundPayment).toHaveBeenCalledWith('pay_123', 30_000);
    // Atomic claim increments refundedAmount and does NOT flip to REFUNDED
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.refundedAmount).toEqual({ increment: 30_000 });
    expect(claim.data.paymentStatus).toBeUndefined();
    expect(claim.where.refundedAmount).toEqual({ lte: 70_000 });
    // Partial → no terminal side-effects
    expect(zohoBooks.createCommissionCreditNote).not.toHaveBeenCalled();
    expect(notifications.resolveByEntity).not.toHaveBeenCalled();
    // Buyer is told the partial amount, not buyerTotal
    expect(notifications.refundIssuedBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ buyerTotal: 30_000 }),
    );
  });

  it('full refund (no amount): refunds remaining balance, flips REFUNDED, fires credit note', async () => {
    const { service, prisma, zohoBooks, notifications, refundPayment } = makeService({
      tx: { ...baseTx },
    });
    await service.refundTransaction('TX1', 'admin1', 'full refund');

    expect(refundPayment).toHaveBeenCalledWith('pay_123', 100_000);
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('REFUNDED');
    expect(zohoBooks.createCommissionCreditNote).toHaveBeenCalledWith('TX1', 'full refund');
    expect(notifications.resolveByEntity).toHaveBeenCalled();
  });

  it('partial that completes the balance flips REFUNDED + credit note', async () => {
    const { service, prisma, zohoBooks } = makeService({
      tx: { ...baseTx, refundedAmount: 70_000 },
    });
    await service.refundTransaction('TX1', 'admin1', 'final 300', 30_000);
    const claim = prisma.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.paymentStatus).toBe('REFUNDED');
    expect(zohoBooks.createCommissionCreditNote).toHaveBeenCalled();
  });

  it('rejects an over-refund beyond the remaining balance', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, refundedAmount: 80_000 },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'too much', 30_000),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('rejects below the R1 gateway minimum', async () => {
    const { service, refundPayment } = makeService({ tx: { ...baseTx } });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'tiny', 50),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('rejects when already fully refunded', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, refundedAmount: 100_000 },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'again'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('rejects a non-refundable status without touching the gateway', async () => {
    const { service, refundPayment } = makeService({
      tx: { ...baseTx, paymentStatus: 'RELEASED' },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('rolls back the reservation when the gateway fails', async () => {
    const { service, prisma } = makeService({
      tx: { ...baseTx },
      refundSuccess: false,
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'gw down', 30_000),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Reservation decremented back, urgent alert raised
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundedAmount: { decrement: 30_000 } }),
      }),
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });
});
