import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { OzowService } from './ozow.service';
import { PeachService } from './peach.service';

export interface NormalizedCheckout {
  provider: PaymentProvider;
  checkoutId: string;
  redirectUrl: string;
  merchantReference: string;
}

export interface NormalizedPaymentStatus {
  provider: PaymentProvider;
  paymentId: string;
  merchantReference: string;
  resultCode: string;
  amountCents: number;
  currency: 'ZAR';
  isSuccess: boolean;
}

export interface PaymentMethodOption {
  provider: PaymentProvider;
  label: string;
  description: string;
}

export interface RefundResult {
  success: boolean;
  resultCode?: string;
  message?: string;
}

/**
 * The single provider seam for the money engine. Every pay-in, status query
 * and refund goes through here so a transaction can never quietly move to a
 * different gateway mid-life. Payouts are partitioned by the same provider in
 * ManualPaymentsService.
 */
@Injectable()
export class PaymentRailsService {
  constructor(
    private readonly ozow: OzowService,
    private readonly peach: PeachService,
    private readonly settings: SettingsService,
  ) {}

  async isPayInEnabled(provider: PaymentProvider): Promise<boolean> {
    if (provider === PaymentProvider.OZOW) return true;
    return (
      this.peach.isCheckoutConfigured() &&
      (await this.settings.get(FLAGS.peachPayinEnabled))
    );
  }

  async isPayoutEnabled(provider: PaymentProvider): Promise<boolean> {
    if (provider === PaymentProvider.OZOW) return true;
    return (
      this.peach.isPayoutsConfigured() &&
      (await this.settings.get(FLAGS.peachPayoutsEnabled))
    );
  }

  async enabledPayInMethods(): Promise<PaymentMethodOption[]> {
    const methods: PaymentMethodOption[] = [
      {
        provider: PaymentProvider.OZOW,
        label: 'Instant EFT',
        description: 'Pay securely from your bank account via Ozow.',
      },
    ];
    if (await this.isPayInEnabled(PaymentProvider.PEACH)) {
      methods.push({
        provider: PaymentProvider.PEACH,
        label: 'Card',
        description: 'Pay with a debit or credit card via Peach.',
      });
    }
    return methods;
  }

  async createCheckout(
    provider: PaymentProvider,
    params: {
      amountZarCents: number;
      merchantTransactionId: string;
      returnUrl: string;
      expirySeconds?: number;
    },
  ): Promise<NormalizedCheckout> {
    if (!(await this.isPayInEnabled(provider))) {
      throw new ServiceUnavailableException(
        'That payment method is not available right now.',
      );
    }
    if (provider === PaymentProvider.PEACH) {
      const checkout = await this.peach.createCheckout({
        amountZarCents: params.amountZarCents,
        merchantTransactionId: params.merchantTransactionId,
        shopperResultUrl: params.returnUrl,
        notificationUrl: this.publicWebhookUrl('/payments/webhook/peach'),
      });
      return {
        provider,
        checkoutId: checkout.paymentId,
        redirectUrl: checkout.redirectUrl,
        merchantReference: checkout.merchantReference,
      };
    }
    const checkout = await this.ozow.createPayment({
      amountZarCents: params.amountZarCents,
      merchantTransactionId: params.merchantTransactionId,
      returnUrl: params.returnUrl,
      ...(params.expirySeconds ? { expirySeconds: params.expirySeconds } : {}),
    });
    return {
      provider,
      checkoutId: checkout.paymentId,
      redirectUrl: checkout.redirectUrl,
      merchantReference: checkout.merchantReference,
    };
  }

  async getPaymentStatus(
    provider: PaymentProvider,
    checkoutId: string,
  ): Promise<NormalizedPaymentStatus | null> {
    if (provider === PaymentProvider.PEACH) {
      const status = await this.peach.getPaymentStatus(checkoutId);
      return {
        provider,
        paymentId: status.paymentId,
        merchantReference: status.merchantReference,
        resultCode: status.status,
        amountCents: status.amountCents,
        currency: 'ZAR',
        isSuccess: status.isSuccess,
      };
    }
    const status = await this.ozow.getPaymentStatus(checkoutId);
    if (!status) return null;
    return {
      provider,
      paymentId: status.transactionId,
      merchantReference: status.merchantReference,
      resultCode: status.status,
      amountCents: status.amountCents,
      currency: 'ZAR',
      isSuccess: status.isSuccess,
    };
  }

  async refund(
    provider: PaymentProvider,
    paymentId: string,
    amountZarCents: number,
  ): Promise<RefundResult> {
    if (provider === PaymentProvider.PEACH) {
      return this.peach.refundPayment(paymentId, amountZarCents);
    }
    return this.ozow.refundPayment(paymentId, amountZarCents);
  }

  /** Public /api origin, used by providers that need a server-to-server
   *  notification URL at checkout-create time. */
  private publicWebhookUrl(path: string): string | undefined {
    const base = process.env.PUBLIC_API_URL
      ? process.env.PUBLIC_API_URL.replace(/\/$/, '')
      : process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL.replace(/\/$/, '')}/api`
        : undefined;
    if (!base) return undefined;
    const url = `${base}${path}`;
    return /^https:\/\//i.test(url) ? url : undefined;
  }
}
