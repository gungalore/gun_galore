import { Injectable, Logger } from '@nestjs/common';
import { verifyYocoWebhook, type YocoSignatureVerdict } from './yoco-signature';

/**
 * Yoco Checkout API adapter (hosted checkout, redirect flow).
 *
 * The motivation paygate's ONLY rail since 2026-11-22. Yoco is not offered to
 * the marketplace, so nothing here is reachable from a Transaction.
 *
 * Endpoints used (developer.yoco.com/api-reference/checkout-api):
 *   POST /api/checkouts                create a hosted checkout
 *   GET  /api/checkouts/{id}           authoritative status, incl. paymentId
 *   POST /api/checkouts/{id}/refund    full or partial refund
 *
 * ⚠️ EVERY MONEY DECISION IS TAKEN FROM THE GATEWAY'S ANSWER. The webhook is a
 * hint that something moved; the caller re-reads the checkout before it marks
 * anything paid, so a forged or stale delivery cannot book revenue.
 *
 * Dependency-free on purpose (it injects nothing), which is what lets
 * YocoModule be @Global like the Ozow and Peach adapters.
 */

export interface YocoCheckout {
  checkoutId: string;
  redirectUrl: string;
  status: string;
  paymentId: string | null;
  amountCents: number;
  /** `live` or `test`. A test capture is not revenue. */
  mode: 'live' | 'test' | null;
  clientReferenceId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface YocoCreateCheckoutParams {
  amountZarCents: number;
  /** Our reference. Sent as Yoco's `clientReferenceId` so it comes back. */
  reference: string;
  returnUrl: string;
  /** Extra keys merged into the checkout metadata (all strings). */
  metadata?: Record<string, string>;
  /** ISO instant. Yoco allows 30 minutes to 70 days out. */
  expiresAt?: string;
}

export interface YocoRefundResult {
  success: boolean;
  refundId?: string;
  status?: string;
  message?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

interface YocoCheckoutBody {
  id?: string;
  redirectUrl?: string;
  status?: string;
  paymentId?: string | null;
  amount?: number;
  processingMode?: string;
  clientReferenceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class YocoService {
  private readonly logger = new Logger(YocoService.name);

  private get secret(): string {
    return (process.env.YOCO_SECRET_KEY ?? '').trim();
  }

  private get apiBase(): string {
    return (
      process.env.YOCO_API_BASE?.replace(/\/+$/, '') ?? 'https://payments.yoco.com'
    );
  }

  /** A key is present. Does not say whether it may take real money. */
  isConfigured(): boolean {
    return this.secret.startsWith('sk_');
  }

  /** `sk_test_...` — a checkout created with this takes no real money. */
  isTestKey(): boolean {
    return this.secret.startsWith('sk_test_');
  }

  /**
   * ⚠️ THE ONLY WAY A TEST KEY MAY TAKE MONEY IN PRODUCTION.
   *
   * Operator, 2026-11-22: production is the test bench until the live keys are
   * installed. This flag exists for exactly that window: it is deliberately
   * explicit, logged on every boot, and must be removed when the live key
   * lands. A test capture it allows is still marked on the row (`gatewayMode`)
   * and raises an alert, so it can never be mistaken for real revenue later.
   */
  allowsTestInProduction(): boolean {
    return process.env.YOCO_ALLOW_TEST_IN_PRODUCTION === 'true';
  }

  /**
   * Safe to take a payment in THIS environment.
   *
   * A test key in production is refused unless the operator has explicitly
   * opened the test window — otherwise a test-mode capture would mark a
   * document paid like any other and the document would be written for money
   * that never arrived.
   */
  isUsable(): boolean {
    if (!this.isConfigured()) return false;
    if (
      this.isTestKey() &&
      process.env.NODE_ENV === 'production' &&
      !this.allowsTestInProduction()
    ) {
      return false;
    }
    return true;
  }

  async createCheckout(
    params: YocoCreateCheckoutParams,
  ): Promise<YocoCheckout> {
    const body: Record<string, unknown> = {
      amount: params.amountZarCents,
      currency: 'ZAR',
      // All three point back at the pack screen, which runs the verify. Yoco
      // requires the success/cancel/failure URLs to be absolute.
      successUrl: params.returnUrl,
      cancelUrl: params.returnUrl,
      failureUrl: params.returnUrl,
      clientReferenceId: params.reference,
      metadata: { reference: params.reference, ...params.metadata },
    };
    if (params.expiresAt) body.expiresAt = params.expiresAt;

    const res = await fetch(`${this.apiBase}/api/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
        // Same reference on a retry returns the SAME checkout rather than
        // minting a second payable link.
        'Idempotency-Key': params.reference,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Yoco checkout create failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    const parsed = this.parse(text);
    if (!parsed?.id || !parsed.redirectUrl) {
      throw new Error('Yoco checkout create returned no checkout id/redirectUrl');
    }
    return this.normalise(parsed);
  }

  /** Null when Yoco does not know the checkout (404). */
  async getCheckout(checkoutId: string): Promise<YocoCheckout | null> {
    const res = await fetch(
      `${this.apiBase}/api/checkouts/${encodeURIComponent(checkoutId)}`,
      {
        headers: { Authorization: `Bearer ${this.secret}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Yoco checkout status failed (${res.status}): ${text.slice(0, 300)}`,
      );
    }
    const parsed = this.parse(text);
    if (!parsed?.id) return null;
    return this.normalise(parsed);
  }

  /**
   * Refund a checkout. Yoco keys refunds on the CHECKOUT id (not the payment
   * id), so callers must pass `gatewayCheckoutId`.
   */
  async refundCheckout(
    checkoutId: string,
    amountCents?: number,
  ): Promise<YocoRefundResult> {
    const res = await fetch(
      `${this.apiBase}/api/checkouts/${encodeURIComponent(checkoutId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `refund-${checkoutId}`,
        },
        body: JSON.stringify(
          amountCents === undefined ? {} : { amount: amountCents },
        ),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(
        `Yoco refund for ${checkoutId} failed (${res.status}): ${text.slice(0, 200)}`,
      );
      return { success: false, message: `HTTP ${res.status}` };
    }
    const parsed = this.parse(text) as
      | { refundId?: string; status?: string; message?: string }
      | null;
    const status = parsed?.status;
    return {
      success: status === 'succeeded' || status === 'pending',
      ...(parsed?.refundId ? { refundId: parsed.refundId } : {}),
      ...(status ? { status } : {}),
      ...(parsed?.message ? { message: parsed.message } : {}),
    };
  }

  /**
   * The reference we minted, recovered from a webhook or a checkout.
   * Yoco echoes `clientReferenceId` and (in practice) also copies it into
   * `metadata`, but never rely on one of the two alone.
   */
  referenceOf(
    source: YocoCheckout | { metadata?: Record<string, unknown> | null },
  ): string | null {
    if ('clientReferenceId' in source && source.clientReferenceId) {
      return source.clientReferenceId;
    }
    const ref = source.metadata?.['reference'];
    return typeof ref === 'string' && ref ? ref : null;
  }

  verifyWebhook(input: {
    rawBody: string;
    headers: { id?: string; timestamp?: string; signature?: string };
  }): YocoSignatureVerdict {
    return verifyYocoWebhook({
      rawBody: input.rawBody,
      headers: input.headers,
      secret: process.env.YOCO_WEBHOOK_SECRET,
    });
  }

  private parse(text: string): YocoCheckoutBody | null {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as YocoCheckoutBody)
        : null;
    } catch {
      this.logger.warn('Yoco returned a non-JSON body');
      return null;
    }
  }

  private normalise(body: YocoCheckoutBody): YocoCheckout {
    const mode =
      body.processingMode === 'live' || body.processingMode === 'test'
        ? body.processingMode
        : null;
    return {
      checkoutId: body.id ?? '',
      redirectUrl: body.redirectUrl ?? '',
      status: body.status ?? 'created',
      // Yoco returns "" (not null) for a checkout that has no payment yet.
      paymentId: body.paymentId ? body.paymentId : null,
      amountCents: body.amount ?? 0,
      mode,
      clientReferenceId: body.clientReferenceId ?? null,
      metadata: body.metadata ?? null,
    };
  }
}
