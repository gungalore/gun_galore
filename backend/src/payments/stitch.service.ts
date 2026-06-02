import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

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

  /**
   * Redirect URLs we've already registered on the Stitch account this
   * process lifetime. Express requires a redirect URL to be registered
   * (POST /api/v1/redirect-urls) before it can be appended to a payment
   * link via ?redirect_url=. Registration is idempotent on Stitch's side
   * (re-POSTing an existing URL is a no-op / "already exists"), so this
   * in-memory set is purely to avoid a redundant network call per
   * checkout — a cold process just re-registers once on its first sale.
   */
  private readonly registeredRedirects = new Set<string>();

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

    // Register the post-payment redirect URL (best-effort) so we can
    // append it to the hosted link. If registration fails we proceed
    // WITHOUT a redirect rather than blocking the sale — the payment
    // still completes; the buyer just lands on Stitch's own done page
    // and the order is reconciled via the webhook (deferred) instead.
    const registeredRedirect = await this.ensureRedirectRegistered(
      params.shopperResultUrl,
    );

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
    // Append the registered redirect so the buyer returns to
    // /checkout/complete after paying. Express format:
    //   https://express.stitch.money/<code>?redirect_url=<encoded>
    const redirectUrl = registeredRedirect
      ? `${link}${link.includes('?') ? '&' : '?'}redirect_url=${encodeURIComponent(registeredRedirect)}`
      : link;
    return { paymentId: id, redirectUrl };
  }

  /**
   * Ensure `url` is registered as a Stitch Express redirect URL, so it
   * can be appended to a payment link. Returns the URL on success (or if
   * already registered), else null — callers then skip the redirect
   * append and let the webhook/reconcile path settle the order.
   *
   * Stitch matches the appended redirect_url against the registered set,
   * so we register + append the EXACT same string (the base
   * /checkout/complete URL). The per-transaction id is carried back via
   * the browser (localStorage) + the webhook's merchantReference, not via
   * this URL — keeping one stable registered value instead of one per
   * order.
   */
  private async ensureRedirectRegistered(
    url: string | null | undefined,
  ): Promise<string | null> {
    if (!url) return null;
    if (this.registeredRedirects.has(url)) return url;
    try {
      const res = await fetch(`${this.apiUrl}/api/v1/redirect-urls`, {
        method: 'POST',
        headers: await this.authHeaders('client_paymentrequest'),
        body: JSON.stringify({ redirectUrl: url }),
      });
      // 2xx = registered; 409/422 = already exists → also usable.
      if (res.ok || res.status === 409 || res.status === 422) {
        this.registeredRedirects.add(url);
        return url;
      }
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Stitch register redirect-url ${res.status}: ${text} — proceeding without redirect`,
      );
      return null;
    } catch (err) {
      this.logger.warn(
        `Stitch register redirect-url failed: ${(err as Error).message} — proceeding without redirect`,
      );
      return null;
    }
  }

  // ─── Get / verify payment status ──────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<StitchPaymentResult> {
    if (!this.isConfigured) throw new Error('Stitch not configured');

    const res = await fetch(
      `${this.apiUrl}/api/v1/payment/${encodeURIComponent(paymentId)}`,
      { headers: await this.authHeaders('client_paymentrequest') },
    );
    // The PAYMENT object only exists once the buyer has actually paid —
    // before that, only the payment LINK exists, so the status endpoint
    // 404s. Treat that as "not paid yet" (a normal non-success), NOT an
    // error: the buyer may have abandoned or not finished. Any other
    // non-OK (auth, 5xx) is a real fault and still throws.
    if (res.status === 404) {
      return {
        paymentId,
        merchantReference: '',
        status: 'NOT_FOUND',
        amountCents: 0,
        isSuccess: false,
      };
    }
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

  // ─── Webhook signature verification (Svix) ────────────────────────
  // Stitch Express delivers webhooks via Svix. Each request carries
  // `svix-id`, `svix-timestamp`, `svix-signature` headers. The signature
  // is HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` keyed by the
  // webhook's signing secret (format `whsec_<base64>`), base64-encoded.
  // The signature header is a space-separated list of `v1,<sig>` entries.
  //
  // Fail-closed in production: if STITCH_WEBHOOK_SECRET is unset we REJECT
  // so an attacker can't post a forged "payment.paid". In non-production
  // we pass through for local testing.
  verifyWebhookSignature(
    rawBody: string,
    headers: { id?: string; timestamp?: string; signature?: string },
  ): boolean {
    const secret = process.env.STITCH_WEBHOOK_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'STITCH_WEBHOOK_SECRET unset — rejecting webhook (fail-closed)',
        );
        return false;
      }
      this.logger.warn(
        'STITCH_WEBHOOK_SECRET unset — accepting webhook (dev only)',
      );
      return true;
    }

    const { id, timestamp, signature } = headers;
    if (!id || !timestamp || !signature) return false;

    // Reject stale/replayed deliveries (5-minute tolerance).
    const tsSec = Number(timestamp);
    if (!Number.isFinite(tsSec)) return false;
    if (Math.abs(Date.now() - tsSec * 1000) > 5 * 60 * 1000) {
      this.logger.warn('Stitch webhook timestamp outside tolerance — rejecting');
      return false;
    }

    // Secret is `whsec_<base64>`; the signing key is the decoded part.
    const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const key = Buffer.from(keyB64, 'base64');
    const signedContent = `${id}.${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', key)
      .update(signedContent)
      .digest('base64');
    const expectedBuf = Buffer.from(expected);

    // Header: "v1,sig1 v1,sig2 ..." — accept if ANY v1 sig matches.
    return signature
      .split(' ')
      .map((part) => part.split(',')[1] ?? part)
      .some((sig) => {
        const sigBuf = Buffer.from(sig);
        return (
          sigBuf.length === expectedBuf.length &&
          timingSafeEqual(sigBuf, expectedBuf)
        );
      });
  }

  // Pull the payment id (+ optional reference/type) out of a Stitch
  // webhook body. The exact envelope isn't pinned in the OpenAPI, so we
  // probe the common shapes defensively. The id is what we actually need —
  // the handler re-fetches authoritative status via getPaymentStatus().
  parseWebhookEvent(body: Record<string, unknown>): {
    paymentId?: string;
    merchantReference?: string;
    type?: string;
  } {
    const pick = (obj: unknown, key: string): unknown =>
      obj && typeof obj === 'object'
        ? (obj as Record<string, unknown>)[key]
        : undefined;
    const data = pick(body, 'data') ?? pick(body, 'payment') ?? body;
    const rawId =
      pick(data, 'id') ??
      pick(pick(data, 'payment'), 'id') ??
      pick(body, 'id') ??
      pick(body, 'paymentId');
    const rawRef =
      pick(data, 'merchantReference') ?? pick(body, 'merchantReference');
    const rawType =
      pick(body, 'type') ?? pick(body, 'event') ?? pick(body, 'eventType');
    return {
      paymentId: rawId != null ? String(rawId) : undefined,
      merchantReference: rawRef != null ? String(rawRef) : undefined,
      type: rawType != null ? String(rawType) : undefined,
    };
  }
}
