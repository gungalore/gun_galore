// The paygate. What these tests protect, in order of how much money each one
// saves: no document is written unpaid; the amount is bound to the snapshot the
// checkout was created for; money taken twice is seen; an abandoned tab still
// ends up paid; a Yoco webhook cannot book a payment on its own.
//
// `start()` refuses when payments are not live, so stub the mode seam exactly
// as the checkout specs do.

jest.mock('../payments/payment-mode', () => ({
  PAYMENT_MODE: 'paygate',
  PAYMENTS_LIVE: true,
  assertPaymentsLive: () => undefined,
  CART_CHECKOUT_LIVE: false,
  assertCartCheckoutLive: () => undefined,
}));

import { ConflictException } from '@nestjs/common';
import { MotivationPaymentsService } from './motivation-payments.service';
import { FLAGS } from '../settings/settings.service';

const PAID_ROW = {
  id: 'mo-1',
  referenceNumber: 'MO000123',
  status: 'COMPLETED',
  billedCents: 29_500,
  paidAt: new Date('2026-11-20T10:00:00Z'),
  betaSeatNo: null,
  declarationAcceptedAt: new Date('2026-11-20T09:00:00Z'),
};

const UNPAID_ROW = {
  ...PAID_ROW,
  status: 'DRAFT',
  billedCents: 0,
  paidAt: null,
};

const ATTEMPT = {
  id: 'pay-1',
  motivationId: 'mo-1',
  userId: 'user-1',
  motivationRef: 'MO000123',
  amountCents: 29_500,
  provider: 'YOCO',
  status: 'PENDING',
  gatewayCheckoutId: 'ch_1',
  gatewayMerchantRef: 'MO000123-ABC123',
  gatewayMode: 'live',
  redirectUrl: 'https://c.yoco.com/checkout/abc',
  paidAt: null,
  failedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function build(
  opts: {
    paidMode?: boolean;
    motivation?: Record<string, unknown> | null;
    pending?: Record<string, unknown> | null;
    siblingsPaid?: number;
    pendingList?: Record<string, unknown>[];
    status?: Record<string, unknown> | null;
    statusThrows?: boolean;
    railEnabled?: boolean;
    allowTestInProduction?: boolean;
  } = {},
) {
  const paidMode = opts.paidMode ?? true;
  const settings = {
    get: jest.fn(async (flag: { key: string }) => {
      if (flag.key === 'motivation_paid_enabled') return paidMode;
      if (flag.key === 'motivation_price_cents') return 29_500;
      return 0;
    }),
  };
  const rails = {
    isPayInEnabled: jest.fn(async () => opts.railEnabled ?? true),
    createCheckout: jest.fn(
      async (
        provider: string,
        params: { merchantTransactionId: string },
      ) => ({
        provider,
        checkoutId: 'ch_1',
        redirectUrl: 'https://c.yoco.com/checkout/abc',
        merchantReference: params.merchantTransactionId,
        mode: 'live',
      }),
    ),
    getPaymentStatus: jest.fn(async () => {
      if (opts.statusThrows) throw new Error('gateway down');
      return (
        opts.status ?? {
          provider: 'YOCO',
          paymentId: 'pay_1',
          merchantReference: 'MO000123-ABC123',
          resultCode: 'completed',
          amountCents: 29_500,
          currency: 'ZAR',
          isSuccess: true,
          mode: 'live',
        }
      );
    }),
  };
  const quota = { assertEnabled: jest.fn(async () => undefined) };
  const engine = { assertAvailable: jest.fn(async () => undefined) };
  const activity = { record: jest.fn(async () => undefined) };
  const yoco = {
    isConfigured: jest.fn(() => true),
    isTestKey: jest.fn(() => false),
    allowsTestInProduction: jest.fn(
      () => opts.allowTestInProduction ?? false,
    ),
  };

  const prisma: Record<string, any> = {
    motivation: {
      findFirst: jest.fn(async () => opts.motivation ?? null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    motivationPayment: {
      findFirst: jest.fn(async () => opts.pending ?? null),
      findMany: jest.fn(async () => opts.pendingList ?? []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pay-new',
        ...data,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => opts.siblingsPaid ?? 0),
    },
    adminAlert: { create: jest.fn(async () => ({})) },
  };
  prisma.$transaction = async (fn: (tx: never) => Promise<unknown>) =>
    fn(prisma as never);

  const svc = new MotivationPaymentsService(
    prisma as never,
    settings as never,
    rails as never,
    quota as never,
    activity as never,
    engine as never,
    yoco as never,
  );
  return { svc, prisma, rails, settings, quota, engine, yoco, activity };
}

describe('the generation gate', () => {
  it('does nothing while the paygate is off', async () => {
    const { svc, prisma } = build({ paidMode: false });
    await expect(
      svc.assertPaidForGeneration('user-1', 'mo-1'),
    ).resolves.toBeUndefined();
    expect(prisma.motivation.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unpaid motivation with a code the UI can act on', async () => {
    const { svc } = build({ motivation: UNPAID_ROW });
    await expect(svc.assertPaidForGeneration('user-1', 'mo-1')).rejects.toThrow(
      ConflictException,
    );
    await expect(
      svc.assertPaidForGeneration('user-1', 'mo-1'),
    ).rejects.toMatchObject({
      response: { code: 'motivation-payment-required', priceCents: 29_500 },
    });
  });

  it('lets a paid motivation through', async () => {
    const { svc } = build({ motivation: PAID_ROW });
    await expect(
      svc.assertPaidForGeneration('user-1', 'mo-1'),
    ).resolves.toBeUndefined();
  });

  it('lets a grandfathered free-beta row through', async () => {
    const { svc } = build({
      motivation: { ...UNPAID_ROW, betaSeatNo: 38 },
    });
    await expect(
      svc.assertPaidForGeneration('user-1', 'mo-1'),
    ).resolves.toBeUndefined();
  });
});

describe('starting a checkout', () => {
  it('returns alreadyPaid instead of charging twice', async () => {
    const { svc, rails, prisma } = build({ motivation: PAID_ROW });
    const res = await svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za');
    expect(res).toEqual({
      redirectUrl: null,
      amountCents: 29_500,
      alreadyPaid: true,
    });
    expect(rails.createCheckout).not.toHaveBeenCalled();
    expect(prisma.motivationPayment.create).not.toHaveBeenCalled();
  });

  it('refuses before the declaration is signed', async () => {
    const { svc, rails } = build({
      motivation: { ...UNPAID_ROW, declarationAcceptedAt: null },
    });
    await expect(
      svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za'),
    ).rejects.toThrow(/declaration/i);
    expect(rails.createCheckout).not.toHaveBeenCalled();
  });

  it('refuses when the document engine is down, and charges nothing', async () => {
    const { svc, rails, engine } = build({ motivation: UNPAID_ROW });
    engine.assertAvailable.mockRejectedValueOnce(new Error('maintenance'));
    await expect(
      svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za'),
    ).rejects.toThrow(/maintenance/);
    expect(rails.createCheckout).not.toHaveBeenCalled();
  });

  it('refuses when the Yoco rail is not usable in this environment', async () => {
    const { svc, rails } = build({
      motivation: UNPAID_ROW,
      railEnabled: false,
    });
    await expect(
      svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za'),
    ).rejects.toMatchObject({
      response: { code: 'motivation-payments-not-live' },
    });
    expect(rails.createCheckout).not.toHaveBeenCalled();
  });

  it('creates one Yoco checkout at the configured price and remembers it', async () => {
    const { svc, rails, prisma } = build({ motivation: UNPAID_ROW });
    const res = await svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za/');

    expect(res).toEqual({
      redirectUrl: 'https://c.yoco.com/checkout/abc',
      amountCents: 29_500,
      alreadyPaid: false,
    });

    const [provider, params] = rails.createCheckout.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(provider).toBe('YOCO');
    expect(params).toMatchObject({
      amountZarCents: 29_500,
      returnUrl:
        'https://alloutdoor.co.za/licence-centre/mo-1/pack?payment=return',
      expirySeconds: 24 * 60 * 60,
      metadata: {
        motivationId: 'mo-1',
        motivationRef: 'MO000123',
        reference: expect.stringMatching(/^MO000123-[0-9A-F]{8}$/),
      },
    });
    expect(params.merchantTransactionId).toBe(
      (params.metadata as Record<string, string>).reference,
    );

    expect(prisma.motivationPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivationId: 'mo-1',
        userId: 'user-1',
        motivationRef: 'MO000123',
        amountCents: 29_500,
        provider: 'YOCO',
        status: 'PENDING',
        gatewayCheckoutId: 'ch_1',
        gatewayMerchantRef: params.merchantTransactionId,
        gatewayMode: 'live',
        redirectUrl: 'https://c.yoco.com/checkout/abc',
      }),
    });
  });

  it('hands back a checkout opened minutes ago instead of minting a second', async () => {
    const { svc, rails, prisma } = build({
      motivation: UNPAID_ROW,
      pending: { ...ATTEMPT },
    });
    const res = await svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za');
    expect(res.redirectUrl).toBe('https://c.yoco.com/checkout/abc');
    expect(prisma.motivationPayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: 'YOCO' }),
      }),
    );
    expect(rails.createCheckout).not.toHaveBeenCalled();
    expect(prisma.motivationPayment.create).not.toHaveBeenCalled();
  });
});

describe('confirming a payment', () => {
  it('marks the attempt paid and writes billedCents on the document', async () => {
    const { svc, prisma } = build({ motivation: UNPAID_ROW, pending: ATTEMPT });

    const res = await svc.verify('user-1', 'mo-1');

    expect(res).toEqual({ paid: true, amountCents: 29_500, status: 'PAID' });
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'PAID',
          gatewayPaymentId: 'pay_1',
        }),
      }),
    );
    // A regeneration must never re-price, so the write is guarded on 0.
    expect(prisma.motivation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mo-1', billedCents: 0 },
        data: expect.objectContaining({ billedCents: 29_500 }),
      }),
    );
  });

  it('cancels the other attempts once one is paid', async () => {
    const { svc, prisma } = build({ motivation: UNPAID_ROW, pending: ATTEMPT });
    await svc.verify('user-1', 'mo-1');
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          motivationId: 'mo-1',
          status: 'PENDING',
          id: { not: 'pay-1' },
        },
        data: { status: 'CANCELLED' },
      }),
    );
  });

  it('settles a Yoco webhook by the reference it carries', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
    });
    await svc.handleYocoEvent({
      type: 'payment.succeeded',
      payload: {
        id: 'pay_1',
        amount: 29_500,
        status: 'succeeded',
        metadata: { reference: 'MO000123-ABC123', motivationId: 'mo-1' },
      },
    });
    expect(prisma.motivationPayment.findFirst).toHaveBeenCalledWith({
      where: { gatewayMerchantRef: 'MO000123-ABC123' },
    });
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('ignores a webhook whose reference matches nothing', async () => {
    const { svc, prisma } = build({ pending: null });
    await expect(
      svc.handleYocoEvent({
        type: 'payment.succeeded',
        payload: { metadata: { reference: 'MO-UNKNOWN' } },
      }),
    ).resolves.toBeUndefined();
    expect(prisma.motivationPayment.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to the checkout id Yoco puts in metadata', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
    });
    prisma.motivationPayment.findFirst.mockResolvedValueOnce(ATTEMPT);
    await svc.handleYocoEvent({
      type: 'payment.succeeded',
      payload: { metadata: { checkoutId: 'ch_1' } },
    });
    expect(prisma.motivationPayment.findFirst).toHaveBeenLastCalledWith({
      where: { gatewayCheckoutId: 'ch_1' },
    });
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('refuses to apply a payment for the wrong amount', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'YOCO',
        paymentId: 'pay_1',
        merchantReference: 'MO000123-ABC123',
        resultCode: 'completed',
        amountCents: 5_000,
        currency: 'ZAR',
        isSuccess: true,
      },
    });

    const res = await svc.verify('user-1', 'mo-1');

    expect(res.paid).toBe(false);
    expect(prisma.motivation.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MOTIVATION_PAYMENT_AMOUNT_MISMATCH',
        urgent: true,
      }),
    });
  });

  it('refuses a payment whose reference is not ours', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'YOCO',
        paymentId: 'pay_1',
        merchantReference: 'MO-SOMEONE-ELSE',
        resultCode: 'completed',
        amountCents: 29_500,
        currency: 'ZAR',
        isSuccess: true,
      },
    });

    const res = await svc.verify('user-1', 'mo-1');

    expect(res.paid).toBe(false);
    expect(prisma.motivation.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MOTIVATION_PAYMENT_REFERENCE_MISMATCH',
      }),
    });
  });

  it('never books test money as revenue in production', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'YOCO',
        paymentId: 'pay_1',
        merchantReference: 'MO000123-ABC123',
        resultCode: 'completed',
        amountCents: 29_500,
        currency: 'ZAR',
        isSuccess: true,
        mode: 'test',
      },
    });
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await svc.verify('user-1', 'mo-1');
      expect(res).toMatchObject({ paid: false, status: 'PENDING' });
      expect(prisma.motivation.updateMany).not.toHaveBeenCalled();
      expect(prisma.adminAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'MOTIVATION_PAYMENT_TEST_MODE' }),
      });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('applies a test capture only while the production test window is open', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      allowTestInProduction: true,
      status: {
        provider: 'YOCO',
        paymentId: 'pay_1',
        merchantReference: 'MO000123-ABC123',
        resultCode: 'completed',
        amountCents: 29_500,
        currency: 'ZAR',
        isSuccess: true,
        mode: 'test',
      },
    });
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await svc.verify('user-1', 'mo-1');
      expect(res).toMatchObject({ paid: true, status: 'PAID' });
      // The capture is applied, but flagged so it is never read as revenue.
      expect(prisma.adminAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'MOTIVATION_PAYMENT_TEST_MODE_APPLIED',
        }),
      });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('stays pending when the gateway cannot be asked', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      statusThrows: true,
    });
    const res = await svc.verify('user-1', 'mo-1');
    expect(res).toMatchObject({ paid: false, status: 'PENDING' });
    expect(prisma.motivation.updateMany).not.toHaveBeenCalled();
  });

  it('reports paid without a pending attempt when the document is already billed', async () => {
    const { svc } = build({ motivation: PAID_ROW, pending: null });
    const res = await svc.verify('user-1', 'mo-1');
    expect(res).toEqual({ paid: true, amountCents: 29_500, status: 'PAID' });
  });

  it('alerts when a second capture lands on the same document', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      siblingsPaid: 1,
    });
    await svc.verify('user-1', 'mo-1');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MOTIVATION_DOUBLE_PAYMENT',
        urgent: true,
      }),
    });
  });
});

describe('the reconcile sweep', () => {
  it('settles attempts the member never came back for', async () => {
    const { svc, prisma } = build({
      pendingList: [{ ...ATTEMPT }],
      motivation: UNPAID_ROW,
    });
    await svc.reconcilePendingPayments();
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      }),
    );
  });

  it('expires checkouts past the expiry we asked the gateway for', async () => {
    const { svc, prisma } = build({ pendingList: [] });
    await svc.reconcilePendingPayments();
    expect(prisma.motivationPayment.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        createdAt: { lte: expect.any(Date) },
      },
      data: { status: 'FAILED', failedAt: expect.any(Date) },
    });
  });

  it('never throws at the scheduler', async () => {
    const { svc, prisma } = build({});
    prisma.motivationPayment.findMany.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(svc.reconcilePendingPayments()).resolves.toBeUndefined();
  });
});

describe('the price and the state', () => {
  it('serves the setting price to an unpaid document', async () => {
    const { svc } = build({ motivation: UNPAID_ROW });
    await expect(svc.state(UNPAID_ROW)).resolves.toEqual({
      required: true,
      paid: false,
      amountCents: 29_500,
      paidAt: null,
    });
    expect(FLAGS.motivationPriceCents.default).toBe(29_500);
  });

  it('reports a paid document as settled at what it cost', async () => {
    const { svc } = build({ motivation: PAID_ROW });
    await expect(svc.state(PAID_ROW)).resolves.toEqual({
      required: false,
      paid: true,
      amountCents: 29_500,
      paidAt: '2026-11-20T10:00:00.000Z',
    });
  });

  it('never asks a free-beta row for money', async () => {
    const { svc } = build({});
    const state = await svc.state({ ...UNPAID_ROW, betaSeatNo: 38 });
    expect(state.required).toBe(false);
  });
});
