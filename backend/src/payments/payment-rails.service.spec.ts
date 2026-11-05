import { PaymentProvider } from '@prisma/client';
import { PaymentRailsService } from './payment-rails.service';
import { FLAGS } from '../settings/settings.service';

function makeService(opts?: {
  peachConfigured?: boolean;
  peachPayin?: boolean;
  peachPayouts?: boolean;
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
  );
  return { service, ozow, peach, settings };
}

describe('PaymentRailsService', () => {
  it('always offers Ozow, and Peach only when configured and flagged on', async () => {
    const off = makeService({ peachConfigured: true, peachPayin: false });
    expect(
      (await off.service.enabledPayInMethods()).map((m) => m.provider),
    ).toEqual([PaymentProvider.OZOW]);

    const on = makeService({ peachConfigured: true, peachPayin: true });
    expect(
      (await on.service.enabledPayInMethods()).map((m) => m.provider),
    ).toEqual([PaymentProvider.OZOW, PaymentProvider.PEACH]);
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
});
