import { Injectable, Logger } from '@nestjs/common';

/**
 * StitchService — Stitch EXPRESS payments adapter.
 *
 * NB: Stitch Express ≠ Stitch enterprise. Express is a simple REST API
 * keyed by a single bearer API key (NOT the enterprise OAuth
 * client_credentials / GraphQL stack). Spec verified 2026-06-01 from
 * https://express.stitch.money/api/openapi.json:
 *
 *   - Base URL:  https://express.stitch.money
 *   - Auth:      POST /api/v1/token { clientId, clientSecret, scope? }
 *                → { success, data.accessToken }. The accessToken is then
 *                sent as `Authorization: Bearer <accessToken>`. Tokens live
 *                15 min with NO refresh — we cache + re-mint at 14 min.
 *                (clientId/clientSecret come from the Express dashboard.)
 *   - Amounts:   INTEGER CENTS. "5000 = R50.00". Our codebase is already
 *                in cents, so amounts pass straight through — NO ÷100.
 *   - Create:    POST /api/v1/payment-links
 *                  body: { amount(cents), payerName(3-40),
 *                          merchantReference(≤50, alnum/space/hyphen),
 *                          payerEmailAddress?, payerPhoneNumber?,
 *                          expiresAt?, deliveryFee?(cents) }
 *                  → { success, data.payment.id, data.payment.link }
 *                    (link = hosted checkout URL we redirect the buyer to)
 *   - Status:    GET  /api/v1/payment/{paymentId}  → status PAID | SETTLED
 *                  (success); also pending/expired states.
 *   - Refund:    POST /api/v1/payment/{paymentId}/refund
 *                  body: { amount(cents, min 100), reason }
 *   - Payout:    POST /api/v1/withdrawal { amount(cents), withdrawalType }
 *                  (withdraws the MERCHANT's Stitch balance to its own
 *                   bank — not an arbitrary third-party disbursement)
 *
 * Return-from-checkout: Express redirect URLs are configured on the
 * account ("Redirect URLs" in the dashboard), not per-request — confirm
 * the post-payment redirect lands on /checkout/complete during testing.
 * Webhook (payment.paid) is deferred per operator.
 */

export interface StitchCheckout {
  /** Stitch payment id — store it; used to query status + refund. */
  paymentId: string;
  /** Hosted checkout link the buyer is redirected to. */
  redirectUrl: string;
}

export interface StitchPaymentResult {
  paymentId: string;
  /** Our order reference (we send Transaction.id as merchantReference). */
  merchantReference: string;
  /** Raw Stitch status, e.g. PAID, SETTLED, PENDING, EXPIRED. */
  status: string;
  /** Amount Stitch reports, in ZAR cents (for amount binding). */
  amountCents: number;
  /** True once the payment is captured (PAID) or settled (SETTLED). */
  isSuccess: boolean;
}

export type StitchRefundReason =
  | 'DUPLICATE'
  | 'FRAUDULENT'
  | 'REQUESTED_BY_USER'
  | 'CANCELLED_PAYMENT';

const SUCCESS_STATUSES = new Set(['PAID', 'SETTLED']);

@Injectable()
export class StitchService {
  private readonly logger = new Logger(StitchService.name);

  /**
   * Cached bearer tokens, keyed by SCOPE. Express tokens are scope-bound:
   * calling an endpoint with a token minted for the wrong scope returns
   * 403 Forbidden, so we mint + cache one per scope. Tokens live 15 min
   * (no refresh); we re-mint at 14 min for safety margin.
   */
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAtMs: number }
  >();

  private get apiUrl(): string {
    return process.env.STITCH_API_URL ?? 'https://express.stitch.money';
  }
  private get clientId(): string {
    return process.env.STITCH_CLIENT_ID ?? '';
  }
  private get clientSecret(): string {
    return process.env.STITCH_CLIENT_SECRET ?? '';
  }
  get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /** Exchange clientId/clientSecret → a scoped bearer access token. */
  private async getAccessToken(scope: string): Promise<string> {
    const cached = this.tokenCache.get(scope);
    if (cached && cached.expiresAtMs > Date.now()) return cached.token;

    const res = await fetch(`${this.apiUrl}/api/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        scope,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stitch token (${scope}) ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: { accessToken?: string };
    };
    const token = json.data?.accessToken;
    if (!token) {
      throw new Error('Stitch token response missing data.accessToken');
    }
    // 15-min TTL, no refresh → cache for 14 min.
    this.tokenCache.set(scope, {
      token,
      expiresAtMs: Date.now() + 14 * 60 * 1000,
    });
    return token;
  }

  private async authHeaders(scope: string): Promise<Record<string, string>> {
    const token = await this.getAccessToken(scope);
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Express requires payerName 3–40 chars. Coerce whatever we have
   * (real name, else username, else a safe default) into range.
   */
  private safePayerName(raw?: string | null): string {
    const cleaned = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return cleaned.length >= 3 ? cleaned : 'Gun Galore Buyer';
  }

  /**
   * merchantReference: ≤50 chars, alphanumeric + spaces/hyphens. Our
   * Transaction.id is a cuid (alphanumeric, ~25 chars) so it passes as-is;
   * strip anything outside the allowed set defensively.
   */
  private safeReference(ref: string): string {
    return ref.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 50);
  }

  // ─── Create checkout (payment link) ───────────────────────────────
  async createCheckout(params: {
    amountZarCents: number;
    merchantTransactionId: string;
    shopperResultUrl: string; // see note re: dashboard-configured redirect
    shopperName?: string | null;
    shopperEmail?: string | null;
  }): Promise<StitchCheckout> {
    if (!this.isConfigured) {
      this.logger.warn('Stitch not configured — returning mock checkout');
      return {
        paymentId: `mock-${params.merchantTransactionId}`,
        redirectUrl: '',
      };
    }

    const payload: Record<string, unknown> = {
      amount: Math.round(params.amountZarCents), // integer cents, no ÷100
      payerName: this.safePayerName(params.shopperName),
      merchantReference: this.safeReference(params.merchantTransactionId),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    if (params.shopperEmail) payload.payerEmailAddress = params.shopperEmail;

    const res = await fetch(`${this.apiUrl}/api/v1/payment-links`, {
      method: 'POST',
      headers: await this.authHeaders('client_paymentrequest'),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stitch createPaymentLink ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: { payment?: { id?: string; link?: string } };
    };
    const id = json.data?.payment?.id;
    const link = json.data?.payment?.link;
    if (!id || !link) {
      throw new Error('Stitch create response missing data.payment.id/link');
    }
    return { paymentId: id, redirectUrl: link };
  }

  // ─── Get / verify payment status ──────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<StitchPaymentResult> {
    if (!this.isConfigured) throw new Error('Stitch not configured');

    const res = await fetch(
      `${this.apiUrl}/api/v1/payment/${encodeURIComponent(paymentId)}`,
      { headers: await this.authHeaders('client_paymentrequest') },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stitch getPaymentStatus ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      data?: {
        payment?: {
          id?: string;
          status?: string;
          amount?: number;
          merchantReference?: string;
        };
      };
      payment?: {
        id?: string;
        status?: string;
        amount?: number;
        merchantReference?: string;
      };
    };
    // Be tolerant of either {data:{payment}} or {payment} envelope shapes.
    const p = json.data?.payment ?? json.payment ?? {};
    const status = p.status ?? 'PENDING';
    return {
      paymentId: p.id ?? paymentId,
      merchantReference: p.merchantReference ?? '',
      status,
      amountCents: Math.round(p.amount ?? 0),
      isSuccess: SUCCESS_STATUSES.has(status),
    };
  }

  // ─── Refund ───────────────────────────────────────────────────────
  async refundPayment(
    paymentId: string,
    amountZarCents: number,
    reason: StitchRefundReason = 'REQUESTED_BY_USER',
  ): Promise<{ success: boolean; resultCode?: string; message?: string }> {
    if (!this.isConfigured) {
      this.logger.warn(
        `Stitch not configured — logging refund intent for ${paymentId} (${amountZarCents}c)`,
      );
      return { success: true, resultCode: 'MOCK_REFUND' };
    }
    const res = await fetch(
      `${this.apiUrl}/api/v1/payment/${encodeURIComponent(paymentId)}/refund`,
      {
        method: 'POST',
        headers: await this.authHeaders('client_refund'),
        body: JSON.stringify({
          amount: Math.round(amountZarCents),
          reason,
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
    };
    if (!res.ok || json.success === false) {
      this.logger.warn(
        `Stitch refund ${paymentId} failed (${res.status}): ${json.message ?? ''}`,
      );
      return {
        success: false,
        resultCode: String(res.status),
        message: json.message,
      };
    }
    return { success: true, resultCode: String(res.status) };
  }

  // ─── Payout / withdrawal (merchant balance → own bank) ────────────
  // NOTE: Express "withdrawal" moves the MERCHANT's Stitch balance to the
  // merchant's own settlement account — it is NOT an arbitrary payout to a
  // seller's bank account. Automating per-seller payouts needs confirmation
  // of whether Express supports third-party disbursement; wired later.
  async withdraw(
    amountZarCents: number,
    withdrawalType: 'INSTANT' | 'DEFAULT' = 'DEFAULT',
  ): Promise<{ success: boolean; message?: string }> {
    if (!this.isConfigured) {
      this.logger.warn('Stitch not configured — skipping withdrawal');
      return { success: false, message: 'not configured' };
    }
    const res = await fetch(`${this.apiUrl}/api/v1/withdrawal`, {
      method: 'POST',
      headers: await this.authHeaders('client_paymentrequest'),
      body: JSON.stringify({
        amount: Math.round(amountZarCents),
        withdrawalType,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
    };
    return { success: res.ok && json.success !== false, message: json.message };
  }
}
