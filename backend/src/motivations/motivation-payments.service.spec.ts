// The paygate. What these tests protect, in order of how much money each one
// saves: no document is written unpaid; the amount is bound to the snapshot the
// checkout was created for; money taken twice is seen; an abandoned tab still
// ends up paid.
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
  provider: 'OZOW',
  status: 'PENDING',
  gatewayCheckoutId: 'chk-1',
  gatewayMerchantRef: 'AOABC123',
  redirectUrl: 'https://one.ozow.com/pay/abc',
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
    createCheckout: jest.fn(async () => ({
      provider: 'OZOW',
      checkoutId: 'chk-1',
      redirectUrl: 'https://one.ozow.com/pay/abc',
      merchantReference: 'AOABC123',
    })),
    getPaymentStatus: jest.fn(async () => {
      if (opts.statusThrows) throw new Error('gateway down');
      return (
        opts.status ?? {
          provider: 'OZOW',
          paymentId: 'tx-1',
          merchantReference: 'AOABC123',
          resultCode: 'Successful',
          amountCents: 29_500,
          currency: 'ZAR',
          isSuccess: true,
        }
      );
    }),
  };
  const quota = { assertEnabled: jest.fn(async () => undefined) };
  const engine = { assertAvailable: jest.fn(async () => undefined) };
  // The principal sale in Books. Stubbed here: the invoice's own shape is
  // covered by the Zoho spec; this one asserts we ASK for it, once, on capture.
  const zoho = { createMotivationInvoice: jest.fn(async () => undefined) };
  const activity = { record: jest.fn(async () => undefined) };

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
    zoho as never,
    activity as never,
    engine as never,
  );
  return { svc, prisma, rails, settings, quota, engine, zoho, activity };
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

  it('creates one checkout at the configured price and remembers it', async () => {
    const { svc, rails, prisma } = build({ motivation: UNPAID_ROW });
    const res = await svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za/');

    expect(res).toEqual({
      redirectUrl: 'https://one.ozow.com/pay/abc',
      amountCents: 29_500,
      alreadyPaid: false,
    });
    expect(rails.createCheckout).toHaveBeenCalledWith('OZOW', {
      amountZarCents: 29_500,
      merchantTransactionId: 'mo-1',
      returnUrl:
        'https://alloutdoor.co.za/licence-centre/mo-1/pack?payment=return',
    });
    expect(prisma.motivationPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivationId: 'mo-1',
        userId: 'user-1',
        motivationRef: 'MO000123',
        amountCents: 29_500,
        status: 'PENDING',
        gatewayCheckoutId: 'chk-1',
        gatewayMerchantRef: 'AOABC123',
        redirectUrl: 'https://one.ozow.com/pay/abc',
      }),
    });
  });

  it('hands back a checkout opened minutes ago instead of minting a second', async () => {
    const { svc, rails, prisma } = build({
      motivation: UNPAID_ROW,
      pending: { ...ATTEMPT },
    });
    const res = await svc.start('user-1', 'mo-1', 'https://alloutdoor.co.za');
    expect(res.redirectUrl).toBe('https://one.ozow.com/pay/abc');
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
          gatewayPaymentId: 'tx-1',
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

  it('books the principal sale in Zoho when the money lands', async () => {
    // A motivation is our own supply: the invoice must be raised from the
    // capture, or the R295 never reaches the ledger as revenue.
    const { svc, zoho } = build({ motivation: UNPAID_ROW, pending: ATTEMPT });
    await svc.verify('user-1', 'mo-1');
    expect(zoho.createMotivationInvoice).toHaveBeenCalledTimes(1);
    expect(zoho.createMotivationInvoice).toHaveBeenCalledWith('pay-1');
  });

  it('never books an attempt the gateway has not confirmed', async () => {
    // The member is not invoiced for money they still owe.
    const { svc, zoho } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'OZOW',
        paymentId: 'tx-1',
        merchantReference: 'AOABC123',
        resultCode: 'Incomplete',
        amountCents: 29_500,
        currency: 'ZAR',
        isSuccess: false,
      },
    });
    await svc.verify('user-1', 'mo-1');
    expect(zoho.createMotivationInvoice).not.toHaveBeenCalled();
  });

  it('refuses to apply a payment for the wrong amount', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'OZOW',
        paymentId: 'tx-1',
        merchantReference: 'AOABC123',
        resultCode: 'Successful',
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

  it('refuses a payment whose merchant reference is not ours', async () => {
    const { svc, prisma } = build({
      motivation: UNPAID_ROW,
      pending: ATTEMPT,
      status: {
        provider: 'OZOW',
        paymentId: 'tx-1',
        merchantReference: 'AOSOMEONEELSE',
        resultCode: 'Successful',
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

  it('expires checkouts past Ozow’s own expiry', async () => {
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
