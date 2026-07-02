// meilisearch is ESM and breaks ts-jest if imported for real (AdminService
// → ListingsService → SearchService pulls it in transitively).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

// Focused money-path tests for AdminService.refundTransaction on the
// MANUAL rail (PAYMENT_MODE defaults to 'manual' in tests, same as prod
// today): the partial-refund accounting, the atomic over-refund guard, and
// the P0.3 synthetic refund CHILD transaction each operation must mint so
// the FNB refund batch actually pays the money out. No gateway is called
// in manual mode — the batch on the child row IS the refund.

function makeService(overrides: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
}) {
  const refundPayment = jest
    .fn()
    .mockResolvedValue({ success: true, resultCode: 'OK' });

  // Interactive-transaction mock: refundTransaction's manual branch runs
  // claim (+ optional terminal flip) + child-create inside
  // prisma.$transaction(async (txc) => ...). findUnique → null makes the
  // service fall back to preRead.refundedAmount + amount for the live
  // cumulative, which is exact for these single-operation tests.
  const txc = {
    transaction: {
      updateMany: jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'CHILD1' }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof txc) => Promise<unknown>) => fn(txc)),
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
  const zohoBooks = {
    createCommissionCreditNote: jest.fn().mockResolvedValue(undefined),
    createCommissionInvoice: jest.fn().mockResolvedValue(undefined),
  };
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
  return { service, prisma, txc, notifications, audit, zohoBooks, refundPayment, transactions };
}

const baseTx = {
  id: 'TX1',
  listingId: 'L1',
  buyerId: 'B1',
  sellerId: 'S1',
  orderReference: 'GG-BN-0001',
  paymentStatus: 'HELD',
  buyerTotal: 100_000, // R1 000
  refundedAmount: 0,
  peachPaymentId: 'pay_123',
  listing: { title: 'Scope' },
  buyer: {
    email: 'b@x.co',
    firstName: 'Bo',
    lastName: 'B',
    phone: null,
    bankAccountHolder: 'Bo B',
    bankAccountNumber: '123456',
    bankBranchCode: '250655',
  },
};

describe('AdminService.refundTransaction (manual rail)', () => {
  it('partial refund: claims the amount, mints a REFUNDED child for the slice, keeps the order open, no gateway', async () => {
    const { service, txc, zohoBooks, notifications, refundPayment } = makeService({
      tx: { ...baseTx },
    });
    await service.refundTransaction('TX1', 'admin1', 'partial damage', 30_000);

    // Manual mode never touches the card gateway.
    expect(refundPayment).not.toHaveBeenCalled();
    // Atomic claim increments refundedAmount and does NOT flip to REFUNDED
    const claim = txc.transaction.updateMany.mock.calls[0][0];
    expect(claim.data.refundedAmount).toEqual({ increment: 30_000 });
    expect(claim.data.paymentStatus).toBeUndefined();
    expect(claim.where.refundedAmount).toEqual({ lte: 70_000 });
    // P0.3 — a synthetic child carries the money through the FNB batch.
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refundOfId: 'TX1',
          paymentStatus: 'REFUNDED',
          buyerTotal: 30_000,
          sellerPayout: 0,
        }),
      }),
    );
    // Partial → no terminal side-effects
    expect(zohoBooks.createCommissionCreditNote).not.toHaveBeenCalled();
    expect(notifications.resolveByEntity).not.toHaveBeenCalled();
    // Buyer is told the partial amount, not buyerTotal
    expect(notifications.refundIssuedBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ buyerTotal: 30_000, manualEft: true, needsBankDetails: false }),
    );
  });

  it('full refund (no amount): claims the remaining balance, flips REFUNDED, mints the child, fires credit note', async () => {
    const { service, txc, zohoBooks, notifications, refundPayment } = makeService({
      tx: { ...baseTx },
    });
    await service.refundTransaction('TX1', 'admin1', 'full refund');

    expect(refundPayment).not.toHaveBeenCalled();
    // Claim (call 0) never carries the flip; the terminal REFUNDED flip is
    // a SECOND guarded update driven by the post-claim live cumulative.
    const flip = txc.transaction.updateMany.mock.calls[1][0];
    expect(flip.data.paymentStatus).toBe('REFUNDED');
    expect(txc.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundOfId: 'TX1', buyerTotal: 100_000 }),
      }),
    );
    expect(zohoBooks.createCommissionCreditNote).toHaveBeenCalledWith('TX1', 'full refund');
    expect(notifications.resolveByEntity).toHaveBeenCalled();
  });

  it('partial that completes the balance flips REFUNDED + credit note', async () => {
    const { service, txc, zohoBooks } = makeService({
      tx: { ...baseTx, refundedAmount: 70_000 },
    });
    await service.refundTransaction('TX1', 'admin1', 'final 300', 30_000);
    const flip = txc.transaction.updateMany.mock.calls[1][0];
    expect(flip.data.paymentStatus).toBe('REFUNDED');
    expect(zohoBooks.createCommissionCreditNote).toHaveBeenCalled();
  });

  it('flags the buyer for bank-detail capture when none are on file', async () => {
    const { service, notifications } = makeService({
      tx: {
        ...baseTx,
        buyer: { ...baseTx.buyer, bankAccountHolder: null, bankAccountNumber: null, bankBranchCode: null },
      },
    });
    await service.refundTransaction('TX1', 'admin1', 'no bank on file', 30_000);
    expect(notifications.refundIssuedBuyer).toHaveBeenCalledWith(
      expect.objectContaining({ needsBankDetails: true }),
    );
  });

  it('rejects an over-refund beyond the remaining balance', async () => {
    const { service, txc } = makeService({
      tx: { ...baseTx, refundedAmount: 80_000 },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'too much', 30_000),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects below the R1 minimum', async () => {
    const { service, txc } = makeService({ tx: { ...baseTx } });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'tiny', 50),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects when already fully refunded', async () => {
    const { service, txc } = makeService({
      tx: { ...baseTx, refundedAmount: 100_000 },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'again'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects a non-refundable status without any claim', async () => {
    const { service, txc } = makeService({
      tx: { ...baseTx, paymentStatus: 'RELEASED' },
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txc.transaction.create).not.toHaveBeenCalled();
  });

  it('rejects (and mints nothing) when the atomic claim loses the race', async () => {
    const { service, txc, notifications } = makeService({
      tx: { ...baseTx },
      claimCount: 0,
    });
    await expect(
      service.refundTransaction('TX1', 'admin1', 'raced', 30_000),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Claim lost → no child, no buyer notification.
    expect(txc.transaction.create).not.toHaveBeenCalled();
    expect(notifications.refundIssuedBuyer).not.toHaveBeenCalled();
  });
});
