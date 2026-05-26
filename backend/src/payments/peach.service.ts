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
    /**
     * Override Peach's server-to-server notification URL. Defaults to
     * the marketplace transactions webhook. Standalone products that
     * don't create a Transaction row (e.g. Ballistic Calculator one-off
     * license) use this to route the webhook to their own handler and
     * avoid the marketplace "unknown transaction" warning.
     */
    notificationUrl?: string;
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
      'notificationUrl':
        params.notificationUrl ??
        `${process.env.BACKEND_URL ?? 'http://localhost:3001'}/api/payments/webhook/peach`,
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
   * Peach Account Verification Service (AVS) — confirms that a bank
   * account number + branch code + account-holder name combination
   * actually exists at the named bank in South Africa. Returns one
   * of:
   *   - { match: true } when AVS confirms the account is valid AND
   *     the holder name matches.
   *   - { match: false, reason: '...' } when AVS rejects (account
   *     doesn't exist, name mismatch, account closed, etc).
   *   - { match: 'mock', reason: 'not configured' } in dev when
   *     PEACH_ENTITY_ID isn't set — caller can decide whether to
   *     accept the bank details optimistically or block save.
   *
   * Spec note: Peach's AVS endpoint shape is documented under their
   * Merchant Account / Banking API. The fields we send are the
   * standard SA AVS quartet: bank code, account number, account
   * type, ID-or-business-reg + a name to match against. We use
   * "real-time AVS" (sync) rather than the batched flavour.
   */
  async verifyBankAccount(params: {
    bankName: string;
    accountHolder: string;
    accountNumber: string;
    branchCode: string;
    accountType: 'cheque' | 'savings' | 'transmission';
    /** SA ID number (13 digits) when person is the account holder.
     *  AVS uses this to validate name-vs-ID at the bank's side. */
    idNumber?: string;
  }): Promise<{
    match: boolean | 'mock';
    reason?: string;
    rawResultCode?: string;
  }> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Peach AVS not configured — accepting ${params.bankName} ` +
          `${params.accountNumber} optimistically (DEV ONLY)`,
      );
      return { match: 'mock', reason: 'Peach AVS not configured' };
    }

    // Peach AVS endpoint shape. The "/v1/accounts/verify" path is
    // their standard sync-AVS route under the live merchant base.
    // If your account is using their newer "Account Verification
    // Service v2", swap to /v2/avs — same auth + similar body.
    const body = new URLSearchParams({
      entityId: this.entityId,
      'bankAccount.holder': params.accountHolder,
      'bankAccount.number': params.accountNumber,
      'bankAccount.branchCode': params.branchCode,
      'bankAccount.bankName': params.bankName,
      'bankAccount.accountType': params.accountType,
      ...(params.idNumber ? { 'customer.identificationDocId': params.idNumber } : {}),
    });

    try {
      const res = await fetch(`${this.baseUrl}/v1/accounts/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        result?: { code?: string; description?: string };
      };
      const code = json.result?.code ?? '';
      const ok = SUCCESS_PATTERN.test(code);
      if (!ok) {
        this.logger.warn(
          `Peach AVS rejected ${params.accountNumber}: ${code} ${json.result?.description ?? ''}`,
        );
      }
      return {
        match: ok,
        reason: ok ? undefined : json.result?.description ?? 'Bank account check failed',
        rawResultCode: code,
      };
    } catch (err) {
      this.logger.error(
        `Peach AVS threw: ${(err as Error).message}`,
      );
      return {
        match: false,
        reason: `AVS network error: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Refund (full or partial) a previously-captured payment. Used by
   * the dispatch-SLA auto-refund cron when a seller fails to ship
   * within the 7-day window.
   *
   * Peach refund flow: POST to /v1/payments/{paymentId} with
   * paymentType=RF + an amount. In test mode (no creds configured)
   * this logs the intent and returns success — the row still gets
   * marked REFUNDED on our side so the buyer sees the resolved
   * state even when the gateway isn't wired.
   */
  async refundPayment(
    paymentId: string,
    amountZarCents: number,
  ): Promise<{ success: boolean; resultCode?: string; message?: string }> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Peach not configured — logging refund intent for ${paymentId} (${amountZarCents}c)`,
      );
      return { success: true, resultCode: 'MOCK_REFUND' };
    }

    const body = new URLSearchParams({
      entityId: this.entityId,
      amount: (amountZarCents / 100).toFixed(2),
      currency: 'ZAR',
      paymentType: 'RF',
    });

    try {
      const res = await fetch(`${this.baseUrl}/v1/payments/${paymentId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        result?: { code?: string; description?: string };
      };
      const resultCode = json.result?.code ?? '';
      const success = SUCCESS_PATTERN.test(resultCode);
      if (!success) {
        this.logger.warn(
          `Peach refund ${paymentId} failed: ${resultCode} ${json.result?.description ?? ''}`,
        );
      }
      return {
        success,
        resultCode,
        message: json.result?.description,
      };
    } catch (err) {
      this.logger.error(
        `Peach refund ${paymentId} threw: ${(err as Error).message}`,
      );
      return { success: false, message: (err as Error).message };
    }
  }

  /**
   * Parses an incoming Peach webhook payload.
   * Peach signs webhooks; verification uses the payload + secret.
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

  /**
   * Verify a Peach webhook signature against the raw request body.
   *
   * Peach signs the raw body with HMAC-SHA256 using the merchant's webhook
   * secret and puts the hex digest in the `X-Initialization-Vector` /
   * `X-Authentication-Tag` headers (depending on Peach's chosen scheme —
   * BANVR confirmation pending). Until we have the live secret + scheme
   * confirmed, this fails OPEN when no secret is configured (the controller
   * still always returns 200 per CLAUDE.md), but is wired in so flipping the
   * env switch turns enforcement on.
   *
   * Returns true if the signature is present and valid, OR if the secret
   * isn't configured (dev mode). Returns false only when a secret IS set
   * but the signature is missing or mismatches.
   */
  verifyWebhookSignature(rawBody: string, providedSignature: string | undefined): boolean {
    const secret = process.env.PEACH_WEBHOOK_SECRET;
    if (!secret) {
      return true; // dev / not configured — allow through
    }
    if (!providedSignature) {
      return false;
    }
    // crypto.createHmac is available in Node 22+
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    // Constant-time compare to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(providedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }
}
