jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    transaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    offer: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    listing: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    ...prismaOverrides,
  };
  const ozow = {
    getPaymentStatus: jest.fn(),
    createPayment: jest.fn(),
  };
  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never,
    ozow as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, ozow };
}

function transaction(over: Record<string, unknown> = {}) {
  return {
    id: 'TX1',
    buyerId: 'B1',
    sellerId: 'S1',
    paidAt: null,
    paymentStatus: 'HELD',
    swapId: null,
    confirmedDeliveryAt: null,
    cancellationRequestedAt: null,
    rejectedAt: null,
    acceptedAt: null,
    dispatchedAt: null,
    shippingMethod: 'COURIER',
    listingId: 'L1',
    buyerTotal: 100_000,
    gatewayCheckoutId: 'CHK1',
    paymentProvider: 'OZOW',
    manualPayByAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(),
    listing: {
      id: 'L1',
      sellerId: 'S1',
      isFirearm: false,
      status: 'PAYMENT_PENDING',
      listingType: 'BUY_NOW',
    },
    buyer: { id: 'B1' },
    ...over,
  };
}

describe('confirmDelivery payment guard', () => {
  it('refuses to release an unpaid HELD transaction', async () => {
    const { service, prisma } = makeService();
    prisma.transaction.findUnique.mockResolvedValue(transaction());

    await expect(service.confirmDelivery('TX1', 'B1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to release a paid courier order before dispatch', async () => {
    const { service, prisma } = makeService();
    prisma.transaction.findUnique.mockResolvedValue(
      transaction({
        paidAt: new Date(),
        acceptedAt: new Date(),
        dispatchedAt: null,
      }),
    );

    await expect(service.confirmDelivery('TX1', 'B1')).rejects.toThrow(
      /not marked this item dispatched/i,
    );
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });
});

describe('resumeCheckout payment guard', () => {
  it('does not mint a second checkout while the first is still Incomplete', async () => {
    const { service, prisma, ozow } = makeService();
    prisma.transaction.findUnique.mockResolvedValue(transaction());
    ozow.getPaymentStatus.mockResolvedValue({
      transactionId: 'TXN1',
      merchantReference: 'REF1',
      status: 'Incomplete',
      amountCents: 100_000,
      isSuccess: false,
    });

    await expect(
      service.resumeCheckout('TX1', 'B1', 'https://x.test'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ozow.createPayment).not.toHaveBeenCalled();
  });

  it('returns the SAME hosted page for an in-flight payment when it was stored', async () => {
    const { service, prisma, ozow } = makeService();
    prisma.transaction.findUnique.mockResolvedValue(
      transaction({ gatewayRedirectUrl: 'https://pay.test/CHK1' }),
    );
    ozow.getPaymentStatus.mockResolvedValue({
      transactionId: 'TXN1',
      merchantReference: 'REF1',
      status: 'Incomplete',
      amountCents: 100_000,
      isSuccess: false,
    });

    const result = await service.resumeCheckout(
      'TX1',
      'B1',
      'https://x.test',
    );

    expect(result).toMatchObject({
      redirectUrl: 'https://pay.test/CHK1',
    });
    expect(ozow.createPayment).not.toHaveBeenCalled();
  });

  it('mints one fresh checkout for the SAME transaction after a terminal failure', async () => {
    const { service, prisma, ozow } = makeService();
    prisma.transaction.findUnique.mockResolvedValue(transaction());
    ozow.getPaymentStatus.mockResolvedValue({
      transactionId: 'TXN1',
      merchantReference: 'REF1',
      status: 'Cancelled',
      amountCents: 100_000,
      isSuccess: false,
    });
    ozow.createPayment.mockResolvedValue({
      paymentId: 'CHK2',
      redirectUrl: 'https://pay.test/CHK2',
      merchantReference: 'REF2',
    });

    const result = await service.resumeCheckout(
      'TX1',
      'B1',
      'https://x.test',
    );

    expect(result).toMatchObject({
      transactionId: 'TX1',
      redirectUrl: 'https://pay.test/CHK2',
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'TX1' },
      data: {
        gatewayCheckoutId: 'CHK2',
        gatewayMerchantRef: 'REF2',
        gatewayRedirectUrl: 'https://pay.test/CHK2',
      },
    });
  });
});

describe('interrupted checkout recovery (2026-11-26 Peach back-button bug)', () => {
  it('does not advertise a lapsed attempt as resumable', async () => {
    const { service, prisma } = makeService();
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'TX1',
      createdAt: new Date(Date.now() - 60 * 60_000),
      manualPayByAt: new Date(Date.now() - 30 * 60_000),
      listing: { listingType: 'BUY_NOW' },
    });
    await expect(
      service.findUnpaidForListing('B1', 'L1'),
    ).resolves.toEqual({ transactionId: null });
  });

  it('still returns a live attempt so Resume stays available', async () => {
    const { service, prisma } = makeService();
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'TX1',
      createdAt: new Date(),
      manualPayByAt: new Date(Date.now() + 10 * 60_000),
      listing: { listingType: 'BUY_NOW' },
    });
    await expect(
      service.findUnpaidForListing('B1', 'L1'),
    ).resolves.toEqual({ transactionId: 'TX1' });
  });

  it('mints a FRESH Peach session on resume instead of reopening a dead page', async () => {
    const ozow = { getPaymentStatus: jest.fn(), createPayment: jest.fn() };
    const prisma = {
      offer: { findFirst: jest.fn().mockResolvedValue(null) },
      transaction: {
        findUnique: jest.fn().mockResolvedValue(
          transaction({
            paymentProvider: 'PEACH',
            gatewayCheckoutId: 'OLD',
            gatewayRedirectUrl: 'https://secure.peachpayments.com/old',
            listing: {
              id: 'L1',
              sellerId: 'S1',
              isFirearm: false,
              status: 'PAYMENT_PENDING',
              listingType: 'BUY_NOW',
            },
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const rails = {
      getPaymentStatus: jest.fn().mockResolvedValue({
        provider: 'PEACH',
        paymentId: 'OLD',
        merchantReference: 'REF1',
        resultCode: '000.200.100',
        amountCents: 100_000,
        currency: 'ZAR',
        isSuccess: false,
      }),
      createCheckout: jest.fn().mockResolvedValue({
        provider: 'PEACH',
        checkoutId: 'NEW',
        redirectUrl: 'https://secure.peachpayments.com/new',
        merchantReference: 'REF2',
      }),
    };
    const service = new TransactionsService(
      prisma as never,
      new FeeCalculator() as never,
      {} as never,
      ozow as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      rails as never,
    );

    const result = await service.resumeCheckout(
      'TX1',
      'B1',
      'https://x.test',
    );

    expect(rails.createCheckout).toHaveBeenCalledWith(
      'PEACH',
      expect.objectContaining({ merchantTransactionId: 'TX1' }),
    );
    expect(result).toMatchObject({
      transactionId: 'TX1',
      redirectUrl: 'https://secure.peachpayments.com/new',
      provider: 'peach',
    });
    expect(prisma.transaction.update).toHaveBeenCalled();
  });
});