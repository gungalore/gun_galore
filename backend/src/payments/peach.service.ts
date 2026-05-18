import { Injectable, Logger } from '@nestjs/common';

export interface PeachCheckout {
  checkoutId: string;
  widgetScriptUrl: string;
}

export interface PeachPaymentResult {
  paymentId: string;
  resultCode: string;
  amount: number;
  currency: string;
  merchantTransactionId: string;
  isSuccess: boolean;
}

// Peach result codes indicating a successful authorisation.
// Source: Peach Payments integration guide.
const SUCCESS_PATTERN = /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.[1][12]0)/;

@Injectable()
export class PeachService {
  private readonly logger = new Logger(PeachService.name);

  private get baseUrl(): string {
    return process.env.PEACH_BASE_URL ?? 'https://test.oppwa.com';
  }

  private get entityId(): string {
    return process.env.PEACH_ENTITY_ID ?? '';
  }

  private get accessToken(): string {
    return process.env.PEACH_ACCESS_TOKEN ?? '';
  }

  private get isConfigured(): boolean {
    return !!(process.env.PEACH_ENTITY_ID && process.env.PEACH_ACCESS_TOKEN);
  }

  /**
   * Creates a Peach embedded checkout session.
   * Returns the checkoutId the frontend renders the widget with.
   */
  async createCheckout(params: {
    amountZarCents: number;
    merchantTransactionId: string; // our Transaction.id
    shopperResultUrl: string;       // where Peach redirects after payment
    shopperEmail?: string;
    description?: string;
  }): Promise<PeachCheckout> {
    if (!this.isConfigured) {
      this.logger.warn('Peach not configured — returning mock checkout');
      return {
        checkoutId: `mock-${params.merchantTransactionId}`,
        widgetScriptUrl: '',
      };
    }

    const amountStr = (params.amountZarCents / 100).toFixed(2);

    const body = new URLSearchParams({
      entityId: this.entityId,
      amount: amountStr,
      currency: 'ZAR',
      paymentType: 'DB', // debit (direct purchase)
      'customer.email': params.shopperEmail ?? '',
      'cart.merchantTransactionId': params.merchantTransactionId,
      'shopperResultUrl': params.shopperResultUrl,
      'notificationUrl': `${process.env.BACKEND_URL ?? 'http://localhost:3001'}/api/payments/webhook/peach`,
    });

    const res = await fetch(`${this.baseUrl}/v1/checkouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Peach createCheckout ${res.status}: ${text}`);
    }

    const json = await res.json();
    return {
      checkoutId: json.id,
      widgetScriptUrl: `${this.baseUrl}/v1/paymentWidgets.js?checkoutId=${json.id}`,
    };
  }

  /**
   * Verifies a payment using the resourcePath returned by Peach after checkout.
   * Called from the result page and also optionally from the webhook.
   */
  async verifyPayment(resourcePath: string): Promise<PeachPaymentResult> {
    if (!this.isConfigured) {
      throw new Error('Peach not configured');
    }

    const url = `${this.baseUrl}${resourcePath}?entityId=${encodeURIComponent(this.entityId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Peach verifyPayment ${res.status}: ${text}`);
    }

    const json = await res.json();
    return {
      paymentId: json.id,
      resultCode: json.result?.code ?? '',
      amount: Math.round(parseFloat(json.amount ?? '0') * 100),
      currency: json.currency ?? 'ZAR',
      merchantTransactionId: json.merchantTransactionId ?? '',
      isSuccess: SUCCESS_PATTERN.test(json.result?.code ?? ''),
    };
  }

  /**
   * Parses an incoming Peach webhook payload.
   * Peach signs webhooks; verification uses the payload + secret.
   * TODO: implement HMAC verification once webhook secret is confirmed with Peach.
   */
  parseWebhookPayload(body: Record<string, unknown>): PeachPaymentResult {
    const resultObj = (body.result ?? {}) as Record<string, unknown>;
    const resultCode = (body['result.code'] ?? resultObj['code'] ?? '') as string;
    return {
      paymentId: (body.id ?? '') as string,
      resultCode,
      amount: Math.round(parseFloat((body.amount ?? '0') as string) * 100),
      currency: (body.currency ?? 'ZAR') as string,
      merchantTransactionId: (body.merchantTransactionId ?? '') as string,
      isSuccess: SUCCESS_PATTERN.test(resultCode),
    };
  }
}
