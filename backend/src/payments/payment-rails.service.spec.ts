import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { PaymentRailsService } from './payment-rails.service';
import { FLAGS } from '../settings/settings.service';

function makeService(opts?: {
  peachConfigured?: boolean;
  peachPayin?: boolean;
  peachPayouts?: boolean;
  yocoUsable?: boolean;
}) {
  const ozow = {
    createPayment: jest.fn().mockResolvedValue({
      paymentId: 'ozow-checkout',
      redirectUrl: 'https://ozow.test/pay',
      merchantReference: 'AO123',
    }),
    getPaymentStatus: jest.fn().mockResolvedValue({
      transactionId: 'ozow-tx',
      merchantReference: 'AO123',
      status: 'successful',
      amountCents: 10_000,
      isSuccess: true,
    }),
    refundPayment: jest
      .fn()
      .mockResolvedValue({ success: true, resultCode: 'OK' }),
  };
  const peach = {
    isCheckoutConfigured: jest
      .fn()
      .mockReturnValue(opts?.peachConfigured ?? false),
    isPayoutsConfigured: jest
      .fn()
      .mockReturnValue(opts?.peachConfigured ?? false),
    createCheckout: jest.fn().mockResolvedValue({
      paymentId: 'peach-checkout',
      redirectUrl: 'https://peach.test/pay',
      merchantReference: 'AP123',
    }),
    getPaymentStatus: jest.fn().mockResolvedValue({
      paymentId: 'peach-tx',
      merchantReference: 'AP123',
      status: '000.100.110',
      amountCents: 10_000,
      isSuccess: true,
    }),
    refundPayment: jest
      .fn()
      .mockResolvedValue({ success: true, resultCode: 'OK' }),
  };
  const yoco = {
    isUsable: jest.fn().mockReturnValue(opts?.yocoUsable ?? false),
    createCheckout: jest.fn().mockResolvedValue({
      checkoutId: 'ch_yoco',
      redirectUrl: 'https://c.yoco.com/checkout/abc',
      status: 'created',
      paymentId: null,
      amountCents: 5000,
      mode: 'test',
      clientReferenceId: 'MO000123-ABC123',
      metadata: null,
    }),
    getCheckout: jest.fn().mockResolvedValue({
      checkoutId: 'ch_yoco',
      redirectUrl: 'https://c.yoco.com/checkout/abc',
      status: 'completed',
      paymentId: 'pay_yoco',
      amountCents: 5000,
      mode: 'test',
      clientReferenceId: 'MO000123-ABC123',
      metadata: null,
    }),
    refundCheckout: jest
      .fn()
      .mockResolvedValue({ success: true, status: 'succeeded' }),
  };
  const settings = {
    get: jest.fn((flag: { key: string }) => {
      if (flag.key === FLAGS.peachPayinEnabled.key) {
        return Promise.resolve(opts?.peachPayin ?? false);
      }
      if (flag.key === FLAGS.peachPayoutsEnabled.key) {
        return Promise.resolve(opts?.peachPayouts ?? false);
      }
      return Promise.resolve(false);
    }),
  };
  const service = new PaymentRailsService(
    ozow as never,
    peach as never,
    settings as never,
    yoco as never,
  );
  return { service, ozow, peach, yoco, settings };
}

describe('PaymentRailsService', () => {
  // The temporary CHECKOUT_PAYIN_PROVIDERS switch is process-wide env, so every
  // case clears it and each case that needs a value sets it explicitly.
  const ORIGINAL_ALLOWLIST = process.env.CHECKOUT_PAYIN_PROVIDERS;

  beforeEach(() => {
    delete process.env.CHECKOUT_PAYIN_PROVIDERS;
  });

  afterEach(() => {
    if (ORIGINAL_ALLOWLIST === undefined) {
      delete process.env.CHECKOUT_PAYIN_PROVIDERS;
    } else {
      process.env.CHECKOUT_PAYIN_PROVIDERS = ORIGINAL_ALLOWLIST;
    }
  });

  it('offers Ozow and Peach by default, Peach only when configured and flagged on', async () => {
    // Env unset = the historical both-rails default.
    const off = makeService({ peachConfigured: true, peachPayin: false });
    expect(
      (await off.service.enabledPayInMethods()).map((m) => m.provider),
    ).toEqual([PaymentProvider.OZOW]);

    const on = makeService({ peachConfigured: true, peachPayin: true });
    expect(
      (await on.service.enabledPayInMethods()).map((m) => m.provider),
    ).toEqual([PaymentProvider.OZOW, PaymentProvider.PEACH]);
  });

  it('uses the updated Peach card copy and keeps the Ozow copy', async () => {
    const { service } = makeService({
      peachConfigured: true,
      peachPayin: true,
    });
    expect(await service.enabledPayInMethods()).toEqual([
      {
        provider: PaymentProvider.OZOW,
        label: 'Instant EFT',
        description: 'Pay securely from your bank account via Ozow.',
      },
      {
        provider: PaymentProvider.PEACH,
        label: 'Credit & Debit Card',
        description: 'Pay securely with your debit or credit card via Peach.',
      },
    ]);
  });

  describe('CHECKOUT_PAYIN_PROVIDERS allowlist', () => {
    it('goes Peach-only for "peach" (case-insensitive) and refuses Ozow checkout', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'PeAcH';
      const { service, peach } = makeService({
        peachConfigured: true,
        peachPayin: true,
      });

      expect(
        (await service.enabledPayInMethods()).map((m) => m.provider),
      ).toEqual([PaymentProvider.PEACH]);
      expect(await service.isPayInEnabled(PaymentProvider.OZOW)).toBe(false);
      await expect(
        service.createCheckout(PaymentProvider.OZOW, {
          amountZarCents: 5000,
          merchantTransactionId: 'tx1',
          returnUrl: 'https://app/checkout/complete',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      // The enabled Peach rail still works.
      expect(await service.isPayInEnabled(PaymentProvider.PEACH)).toBe(true);
      await service.createCheckout(PaymentProvider.PEACH, {
        amountZarCents: 5000,
        merchantTransactionId: 'tx2',
        returnUrl: 'https://app/checkout/complete',
      });
      expect(peach.createCheckout).toHaveBeenCalled();
    });

    it('offers NO methods when Peach is requested but not usable', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'peach';

      // Peach asked for, flag off.
      const flagOff = makeService({ peachConfigured: true, peachPayin: false });
      expect(await flagOff.service.enabledPayInMethods()).toEqual([]);

      // Peach asked for, flag on but the gateway is not configured.
      const notConfigured = makeService({
        peachConfigured: false,
        peachPayin: true,
      });
      expect(await notConfigured.service.enabledPayInMethods()).toEqual([]);
    });

    it('enables NO rails (and does not fall back to Ozow) when every token is unknown', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'stripe,payfast';
      const { service } = makeService({
        peachConfigured: true,
        peachPayin: true,
      });

      expect(await service.enabledPayInMethods()).toEqual([]);
      expect(await service.isPayInEnabled(PaymentProvider.OZOW)).toBe(false);
      expect(await service.isPayInEnabled(PaymentProvider.PEACH)).toBe(false);
    });

    it('ignores unknown tokens but keeps the recognised ones', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'stripe, OZOW';
      const { service } = makeService();
      expect(
        (await service.enabledPayInMethods()).map((m) => m.provider),
      ).toEqual([PaymentProvider.OZOW]);
    });

    it('returns enabled rails in the order the operator listed them', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'peach,ozow';
      const { service } = makeService({
        peachConfigured: true,
        peachPayin: true,
      });
      expect(
        (await service.enabledPayInMethods()).map((m) => m.provider),
      ).toEqual([PaymentProvider.PEACH, PaymentProvider.OZOW]);
    });

    it('treats an empty value as the both-rails default', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = '   ';
      const { service } = makeService({
        peachConfigured: true,
        peachPayin: true,
      });
      expect(
        (await service.enabledPayInMethods()).map((m) => m.provider),
      ).toEqual([PaymentProvider.OZOW, PaymentProvider.PEACH]);
    });

    it('keeps Ozow payouts and refund routing despite a Peach-only pay-in switch', async () => {
      process.env.CHECKOUT_PAYIN_PROVIDERS = 'peach';
      const { service, ozow } = makeService({
        peachConfigured: true,
        peachPayin: true,
        peachPayouts: true,
      });

      // Historical Ozow money must still settle + refund through Ozow.
      expect(await service.isPayoutEnabled(PaymentProvider.OZOW)).toBe(true);
      const refund = await service.refund(PaymentProvider.OZOW, 'ozow-tx', 100);
      expect(refund.success).toBe(true);
      expect(ozow.refundPayment).toHaveBeenCalledWith('ozow-tx', 100);
    });
  });


  it('routes checkout creation to the selected adapter', async () => {
    const { service, ozow, peach } = makeService({
      peachConfigured: true,
      peachPayin: true,
    });
    const ozowResult = await service.createCheckout(PaymentProvider.OZOW, {
      amountZarCents: 5000,
      merchantTransactionId: 'tx1',
      returnUrl: 'https://app/checkout/complete',
    });
    expect(ozowResult.checkoutId).toBe('ozow-checkout');
    expect(ozow.createPayment).toHaveBeenCalled();

    const peachResult = await service.createCheckout(PaymentProvider.PEACH, {
      amountZarCents: 5000,
      merchantTransactionId: 'tx2',
      returnUrl: 'https://app/checkout/complete',
    });
    expect(peachResult.checkoutId).toBe('peach-checkout');
    expect(peach.createCheckout).toHaveBeenCalled();
  });

  it('refuses Peach checkout when the rail is disabled', async () => {
    const { service, peach } = makeService({ peachConfigured: true });
    await expect(
      service.createCheckout(PaymentProvider.PEACH, {
        amountZarCents: 100,
        merchantTransactionId: 'tx',
        returnUrl: 'https://app/checkout/complete',
      }),
    ).rejects.toThrow(/not available/i);
    expect(peach.createCheckout).not.toHaveBeenCalled();
  });

  it('normalizes status and refund calls per provider', async () => {
    const { service, ozow, peach } = makeService({
      peachConfigured: true,
      peachPayin: true,
    });
    const ozowStatus = await service.getPaymentStatus(
      PaymentProvider.OZOW,
      'ozow-checkout',
    );
    expect(ozowStatus?.paymentId).toBe('ozow-tx');
    const peachStatus = await service.getPaymentStatus(
      PaymentProvider.PEACH,
      'peach-checkout',
    );
    expect(peachStatus?.paymentId).toBe('peach-tx');

    await service.refund(PaymentProvider.OZOW, 'ozow-tx', 100);
    await service.refund(PaymentProvider.PEACH, 'peach-tx', 100);
    expect(ozow.refundPayment).toHaveBeenCalledWith('ozow-tx', 100);
    expect(peach.refundPayment).toHaveBeenCalledWith('peach-tx', 100);
  });

  it('gates Peach payouts on the payouts flag, independently of pay-in', async () => {
    const { service } = makeService({
      peachConfigured: true,
      peachPayin: true,
      peachPayouts: false,
    });
    expect(await service.isPayoutEnabled(PaymentProvider.PEACH)).toBe(false);
    expect(await service.isPayInEnabled(PaymentProvider.PEACH)).toBe(true);
  });

  it('routes the motivation paygate to Yoco, and only when it is usable', async () => {
    const { service, yoco } = makeService({ yocoUsable: true });
    const result = await service.createCheckout(PaymentProvider.YOCO, {
      amountZarCents: 29_500,
      merchantTransactionId: 'MO000123-ABC123',
      returnUrl: 'https://alloutdoor.co.za/pack?payment=return',
      expirySeconds: 24 * 60 * 60,
      metadata: { motivationId: 'mo-1' },
    });
    expect(result.checkoutId).toBe('ch_yoco');
    expect(result.merchantReference).toBe('MO000123-ABC123');
    expect(yoco.createCheckout).toHaveBeenCalledWith({
      amountZarCents: 29_500,
      reference: 'MO000123-ABC123',
      returnUrl: 'https://alloutdoor.co.za/pack?payment=return',
      expiresAt: expect.any(String),
      metadata: { motivationId: 'mo-1' },
    });

    const off = makeService({ yocoUsable: false });
    expect(await off.service.isPayInEnabled(PaymentProvider.YOCO)).toBe(false);
    await expect(
      off.service.createCheckout(PaymentProvider.YOCO, {
        amountZarCents: 100,
        merchantTransactionId: 'ref',
        returnUrl: 'https://app/',
      }),
    ).rejects.toThrow(/not available/i);
  });

  it('maps Yoco checkout states onto the normalized status', async () => {
    const { service } = makeService({ yocoUsable: true });
    const status = await service.getPaymentStatus(
      PaymentProvider.YOCO,
      'ch_yoco',
    );
    expect(status).toMatchObject({
      provider: PaymentProvider.YOCO,
      paymentId: 'pay_yoco',
      merchantReference: 'MO000123-ABC123',
      resultCode: 'completed',
      amountCents: 5000,
      isSuccess: true,
      mode: 'test',
    });
    expect(await service.isPayoutEnabled(PaymentProvider.YOCO)).toBe(false);
  });
});
