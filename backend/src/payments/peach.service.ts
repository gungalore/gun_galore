import { Injectable, Logger } from '@nestjs/common';
import {
  signParams,
  verifyFieldSignature,
  verifyWebhookHeaderSignature,
  classifyResultCode,
  classifyPayoutCode,
} from './peach-signature';
import {
  BANV_ACCOUNT_TYPE,
  type BanvFlag,
  type BanvMatches,
} from './peach-banks';

/**
 * PeachService — Peach Payments adapter (Checkout V2 pay-in + Payouts API
 * pay-out), the marketplace money rail (operator decision 2026-07-23).
 *
 * Public surface mirrors the prior StitchService so the rail-agnostic money
 * engine (markPaid amount-binding, refund arms, payout-due gating) is
 * unchanged: createCheckout / getPaymentStatus / refundPayment /
 * verifyWebhookSignature / parseWebhookEvent — plus createPayout (new).
 *
 * Contracts verified 2026-07-23 from developer.peachpayments.com:
 *   Auth (OAuth2 client-credentials, shared by checkout + payouts):
 *     POST {auth}/api/oauth/token { clientId, clientSecret, merchantId }
 *       → { access_token, expires_in }  (Bearer; cache + re-mint early)
 *     auth host  live https://dashboard.peachpayments.com
 *                sbx  https://sandbox-dashboard.peachpayments.com
 *   Checkout V2 (host live https://secure.peachpayments.com,
 *                     sbx  https://testsecure.peachpayments.com):
 *     POST {checkout}/v2/checkout  (Bearer)
 *       body: authentication.entityId, merchantTransactionId(8-16),
 *             amount(DECIMAL string, dot), currency, nonce, shopperResultUrl,
 *             notificationUrl?, cancelUrl?, defaultPaymentMethod?, signature
 *       → { checkoutId, redirectUrl }   (redirect the buyer to redirectUrl)
 *     GET  {checkout}/v2/checkout/{checkoutId}/status  (Bearer)
 *     Result POST to shopperResultUrl == webhook shape (signed).
 *   Refund (host live https://api.peachpayments.com,
 *                sbx  https://testapi.peachpayments.com):
 *     POST {refund}/v1/checkout/refund  (signed)
 *       body: authentication.entityId, amount(decimal), currency,
 *             id(original payment id), paymentType=RF, signature
 *   Payouts (host live https://payouts.peachpayments.com,
 *                 sbx  https://sandbox-payouts.peachpayments.com):
 *     POST {payouts}/api/merchants/{merchantId}/payouts (Bearer) — batch
 *       payouts[] array; integer cents; client-minted UUIDv4 payoutId.
 *     GET  {payouts}/api/merchants/{merchantId}/payouts/{payoutId}
 *
 * AMOUNTS: Peach uses DECIMAL ZAR (e.g. "150.00"). Our codebase is in
 * integer cents, so every outbound amount is (cents/100).toFixed(2) and
 * every inbound amount is Math.round(parseFloat(x)*100). This is the key
 * difference from the old Stitch adapter (which was integer cents).
 *
 * INERT until configured: with no PEACH_* env the service returns mock
 * checkouts / logs intents and never calls out, so nothing breaks before
 * the operator provisions credentials and flips PAYMENT_MODE=paygate.
 */

export interface PeachCheckout {
  /** Peach checkoutId — store it (peachCheckoutId); primary webhook match. */
  paymentId: string;
  /** Hosted checkout URL the buyer is redirected to. */
  redirectUrl: string;
  /** The 8-16 char merchant reference we minted (store on peachMerchantRef). */
  merchantReference: string;
}

export interface PeachPaymentResult {
  paymentId: string;
  merchantReference: string;
  status: string;
  amountCents: number;
  isSuccess: boolean;
}

export type PeachRefundReason =
  | 'DUPLICATE'
  | 'FRAUDULENT'
  | 'REQUESTED_BY_USER'
  | 'CANCELLED_PAYMENT';

export interface PeachPayoutBeneficiary {
  /** Client-minted UUIDv4 — Peach's payoutId; the caller stores it on the
   *  Transaction BEFORE the API call so the status webhook always matches. */
  payoutId: string;
  /** Peach bankName ENUM value (normaliseBankName in peach-banks.ts). */
  bankName: string;
  accountHolder: string;
  bankAccountNumber: string;
  branchCode: string;
  /** Integer ZAR cents — Payouts (unlike Checkout) is minor units. */
  amountCents: number;
  /** Beneficiary statement reference, 1-20 alphanumeric+space. */
  reference: string;
  /** Peach emails the proof-of-payout here (the seller). */
  proofEmail: string;
}

export interface PeachBanvRequest {
  accountNumber: string;
  branchCode: string;
  /** Our stored type: cheque | savings | transmission (mapped to Peach's enum). */
  accountType: string;
  /** SA ID number (13 digits). Never logged. */
  idNumber: string;
  initials?: string;
  lastName?: string;
}

const AUTH_HOST_LIVE = 'https://dashboard.peachpayments.com';
const AUTH_HOST_SBX = 'https://sandbox-dashboard.peachpayments.com';
const CHECKOUT_HOST_LIVE = 'https://secure.peachpayments.com';
const CHECKOUT_HOST_SBX = 'https://testsecure.peachpayments.com';
const REFUND_HOST_LIVE = 'https://api.peachpayments.com';
const REFUND_HOST_SBX = 'https://testapi.peachpayments.com';
const PAYOUTS_HOST_LIVE = 'https://payouts.peachpayments.com';
const PAYOUTS_HOST_SBX = 'https://sandbox-payouts.peachpayments.com';

@Injectable()
export class PeachService {
  private readonly logger = new Logger(PeachService.name);

  // OAuth client-credentials, from the Dashboard. Checkout and Payouts are
  // separately onboarded products and may issue different credentials; the
  // payout pair falls back to the checkout pair when only one is configured.
  private readonly clientId = process.env.PEACH_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.PEACH_CLIENT_SECRET ?? '';
  private readonly merchantId = process.env.PEACH_MERCHANT_ID ?? '';
  private readonly entityId = process.env.PEACH_ENTITY_ID ?? '';
  // Signing secret ("secret token") for checkout create + refund + result
  // signature verification.
  private readonly secret = process.env.PEACH_SECRET ?? '';
  // Checkout V2 webhook signing secret from the Dashboard's "Enable webhook
  // signing" control. This is separate from the classic Hosted Checkout secret
  // token above.
  private readonly webhookSecret = process.env.PEACH_WEBHOOK_SECRET ?? '';

  private readonly payoutClientId =
    process.env.PEACH_PAYOUT_CLIENT_ID || this.clientId;
  private readonly payoutClientSecret =
    process.env.PEACH_PAYOUT_CLIENT_SECRET || this.clientSecret;
  private readonly payoutMerchantId =
    process.env.PEACH_PAYOUT_MERCHANT_ID || this.merchantId;
  // Payout + BANV webhooks are configured in the Payouts product and can use
  // a different signing secret from Checkout.
  private readonly payoutWebhookSecret =
    process.env.PEACH_PAYOUT_WEBHOOK_SECRET || this.secret;

  private readonly live = process.env.PEACH_ENV === 'live';

  private readonly authHost = this.live ? AUTH_HOST_LIVE : AUTH_HOST_SBX;
  private readonly checkoutHost = this.live
    ? CHECKOUT_HOST_LIVE
    : CHECKOUT_HOST_SBX;
  private readonly refundHost = this.live ? REFUND_HOST_LIVE : REFUND_HOST_SBX;
  private readonly payoutsHost = this.live
    ? PAYOUTS_HOST_LIVE
    : PAYOUTS_HOST_SBX;

  // Checkout is "configured" once we can both authenticate and sign.
  private readonly isConfigured = !!(
    this.clientId &&
    this.clientSecret &&
    this.merchantId &&
    this.entityId
  );
  // Payouts + bank-account verification (BANV) use the Payouts product's own
  // client pair where configured.
  private readonly payoutsConfigured = !!(
    this.payoutClientId &&
    this.payoutClientSecret &&
    this.payoutMerchantId
  );

  isCheckoutConfigured(): boolean {
    return this.isConfigured;
  }

  isPayoutsConfigured(): boolean {
    return this.payoutsConfigured;
  }

  /** collectDue consults this: enforce the BANV payout gate only when the
   *  BANV product can actually run (otherwise the manual admin review from
   *  the pre-Peach process remains the gate). */
  isBanvEnabled(): boolean {
    return this.payoutsConfigured;
  }

  // Cached bearer tokens: checkout and payouts can be different OAuth clients.
  private token: { value: string; expiresAt: number } | null = null;
  private payoutToken: { value: string; expiresAt: number } | null = null;

  constructor() {
    if (!this.isConfigured) {
      this.logger.warn(
        'Peach checkout not configured (PEACH_* env missing) — running in MOCK mode; no real charges.',
      );
    }
    if (this.live && this.isConfigured) {
      this.logger.log('Peach adapter: LIVE mode');
    }
  }

  // ─── OAuth ────────────────────────────────────────────────────────
  private async fetchToken(
    clientId: string,
    clientSecret: string,
    merchantId: string,
  ): Promise<{ value: string; expiresAt: number }> {
    const now = Date.now();
    const res = await fetch(`${this.authHost}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, merchantId }),
    });
    if (!res.ok) {
      throw new Error(`Peach oauth token ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      accessToken?: string;
      expires_in?: number;
      expiresIn?: number;
    };
    const value = json.access_token ?? json.accessToken;
    if (!value) throw new Error('Peach oauth: no access_token in response');
    const ttlSec = json.expires_in ?? json.expiresIn ?? 1800;
    return { value, expiresAt: now + ttlSec * 1000 };
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.value;
    }
    this.token = await this.fetchToken(
      this.clientId,
      this.clientSecret,
      this.merchantId,
    );
    return this.token.value;
  }

  private async getPayoutToken(): Promise<string> {
    const now = Date.now();
    if (this.payoutToken && this.payoutToken.expiresAt > now + 60_000) {
      return this.payoutToken.value;
    }
    this.payoutToken = await this.fetchToken(
      this.payoutClientId,
      this.payoutClientSecret,
      this.payoutMerchantId,
    );
    return this.payoutToken.value;
  }

  /** Safe string extraction for webhook fields. Never emits "[object Object]". */
  private asString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }

  private centsToDecimal(cents: number): string {
    return (Math.round(cents) / 100).toFixed(2);
  }
  private decimalToCents(amount: string | number | undefined): number {
    return Math.round(parseFloat(String(amount ?? '0')) * 100);
  }

  /** 8–16 char unique merchant reference (Peach's merchantTransactionId
   *  constraint). "GG" + base36 millis + 4 random-ish chars from the index
   *  of the tx id keeps it unique without leaking the 25-char cuid. */
  private mintMerchantRef(txId: string): string {
    const t = Date.now().toString(36).toUpperCase(); // ~8 chars
    const tail = txId
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-4)
      .toUpperCase();
    return `GG${t}${tail}`.slice(0, 16);
  }

  // ─── Nonce (unique per checkout create) ───────────────────────────
  private nonce(): string {
    return `${Date.now().toString(36)}${Math.round(Math.random() * 1e9).toString(36)}`;
  }

  // ─── Create checkout ──────────────────────────────────────────────
  async createCheckout(params: {
    amountZarCents: number;
    merchantTransactionId: string; // our tx id (used to derive the ref)
    shopperResultUrl: string;
    notificationUrl?: string;
    cancelUrl?: string;
    shopperName?: string | null;
    shopperEmail?: string | null;
  }): Promise<PeachCheckout> {
    const merchantReference = this.mintMerchantRef(
      params.merchantTransactionId,
    );

    if (!this.isConfigured) {
      this.logger.warn('Peach not configured — returning mock checkout');
      return {
        paymentId: `mock-${merchantReference}`,
        redirectUrl: '',
        merchantReference,
      };
    }

    // Checkout V2 authenticates with the OAuth Bearer token. The request body
    // is NOT signed (the classic Hosted Checkout form is). Sending a
    // `signature` field makes the V2 API reject the request as an unknown
    // field.
    const body: Record<string, unknown> = {
      authentication: { entityId: this.entityId },
      merchantTransactionId: merchantReference,
      amount: this.centsToDecimal(params.amountZarCents),
      currency: 'ZAR',
      nonce: this.nonce(),
      shopperResultUrl: params.shopperResultUrl,
    };
    if (params.notificationUrl) body.notificationUrl = params.notificationUrl;
    if (params.cancelUrl) body.cancelUrl = params.cancelUrl;

    // Peach validates the storefront Origin/Referer on checkout creation. This
    // is a server-to-server call, so forward the origin of the shopper result
    // URL; without it Peach returns 400 "Missing referer or origin header".
    let storefrontOrigin: string | undefined;
    try {
      storefrontOrigin = new URL(params.shopperResultUrl).origin;
    } catch {
      storefrontOrigin = undefined;
    }
    const res = await fetch(`${this.checkoutHost}/v2/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
        ...(storefrontOrigin
          ? {
              Origin: storefrontOrigin,
              Referer: `${storefrontOrigin}/`,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Peach createCheckout ${res.status}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      checkoutId?: string;
      redirectUrl?: string;
      result?: { code?: string; description?: string };
    };
    if (!json.checkoutId || !json.redirectUrl) {
      throw new Error(
        `Peach createCheckout missing checkoutId/redirectUrl (result ${json.result?.code ?? '?'})`,
      );
    }
    return {
      paymentId: json.checkoutId,
      redirectUrl: json.redirectUrl,
      merchantReference,
    };
  }

  // ─── Query status ─────────────────────────────────────────────────
  async getPaymentStatus(checkoutId: string): Promise<PeachPaymentResult> {
    if (!this.isConfigured) throw new Error('Peach not configured');
    const res = await fetch(
      `${this.checkoutHost}/v2/checkout/${encodeURIComponent(checkoutId)}/status`,
      { headers: { Authorization: `Bearer ${await this.getToken()}` } },
    );
    if (res.status === 404) {
      return {
        paymentId: checkoutId,
        merchantReference: '',
        status: 'NOT_FOUND',
        amountCents: 0,
        isSuccess: false,
      };
    }
    if (!res.ok) {
      throw new Error(
        `Peach getPaymentStatus ${res.status}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      id?: string;
      merchantTransactionId?: string;
      amount?: string | number;
      result?: { code?: string; description?: string };
    };
    const code = json.result?.code;
    const bucket = classifyResultCode(code);
    return {
      // The refundable payment id is `id`; fall back to the checkoutId.
      paymentId: json.id ?? checkoutId,
      merchantReference: json.merchantTransactionId ?? '',
      status: code ?? 'UNKNOWN',
      amountCents: this.decimalToCents(json.amount),
      isSuccess: bucket === 'success',
    };
  }

  // ─── Refund ───────────────────────────────────────────────────────
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
    const body: Record<string, unknown> = {
      authentication: { entityId: this.entityId },
      amount: this.centsToDecimal(amountZarCents),
      currency: 'ZAR',
      id: paymentId,
      paymentType: 'RF',
    };
    body.signature = signParams(body, this.secret);
    const res = await fetch(`${this.refundHost}/v1/checkout/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      result?: { code?: string; description?: string };
    };
    const code = json.result?.code;
    const ok = res.ok && classifyResultCode(code) !== 'rejected';
    if (!ok) {
      this.logger.warn(
        `Peach refund ${paymentId} failed (${res.status}, code ${code ?? '?'}): ${json.result?.description ?? ''}`,
      );
    }
    return {
      success: ok,
      resultCode: code ?? String(res.status),
      message: json.result?.description,
    };
  }

  // ─── Payout (seller disbursement to their bank) ───────────────────
  // POST /api/merchants/{merchantId}/payouts — real per-seller third-party
  // disbursement, batch-capable (payouts[] array), realtime-eft. Amounts in
  // INTEGER CENTS (min 1000 = R10 per Peach). Contract verified 2026-07-23
  // from Peach's OpenAPI reference.
  async createPayout(beneficiaries: PeachPayoutBeneficiary[]): Promise<{
    success: boolean;
    requestId?: string;
    results: {
      payoutId: string;
      status: string;
      code?: string;
      error?: string;
    }[];
    message?: string;
  }> {
    if (beneficiaries.length === 0) {
      return { success: true, results: [] };
    }
    if (!this.payoutsConfigured) {
      this.logger.warn(
        `Peach payouts not configured — logging payout intent for ${beneficiaries.length} beneficiary(ies), total ${beneficiaries.reduce((s, b) => s + b.amountCents, 0)}c`,
      );
      return {
        success: false,
        results: beneficiaries.map((b) => ({
          payoutId: b.payoutId,
          status: 'not_configured',
        })),
        message: 'payouts not configured',
      };
    }
    const res = await fetch(
      `${this.payoutsHost}/api/merchants/${encodeURIComponent(this.payoutMerchantId)}/payouts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getPayoutToken()}`,
        },
        body: JSON.stringify({
          payouts: beneficiaries.map((b) => ({
            payoutId: b.payoutId,
            bankName: b.bankName,
            accountNumber: b.bankAccountNumber,
            branchCode: b.branchCode,
            amount: Math.round(b.amountCents), // integer CENTS
            currency: 'ZAR',
            accountHolder: b.accountHolder.slice(0, 50),
            reference: b.reference.slice(0, 20),
            payoutMethod: 'realtime-eft',
            proofOfPayout: { to: [b.proofEmail] },
          })),
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      payoutRequestId?: string;
      payouts?: {
        payoutId?: string;
        status?: string;
        resultCode?: string;
        error?: { title?: string; message?: string; code?: string };
      }[];
      message?: string;
    };
    if (!res.ok) {
      this.logger.warn(
        `Peach createPayout ${res.status}: ${json.message ?? ''}`,
      );
      return {
        success: false,
        results: beneficiaries.map((b) => ({
          payoutId: b.payoutId,
          status: 'failed',
          code: String(res.status),
        })),
        message: json.message,
      };
    }
    const results = (json.payouts ?? []).map((p) => ({
      payoutId: p.payoutId ?? '',
      // Peach's own lifecycle enum: pending|processing|successful|failed|
      // cancelled|reversed — pending/processing/successful all mean ACCEPTED.
      status: p.status ?? classifyPayoutCode(p.resultCode),
      code: p.resultCode,
      error: p.error
        ? `${p.error.code ?? ''} ${p.error.message ?? ''}`.trim()
        : undefined,
    }));
    return { success: true, requestId: json.payoutRequestId, results };
  }

  /** Query one payout's current state. Used by the reconciliation cron when
   *  a status webhook is missed. */
  async getPayoutStatus(payoutId: string): Promise<{
    payoutId: string;
    status: string;
    resultCode?: string;
    error?: string;
  } | null> {
    if (!this.payoutsConfigured) return null;
    const res = await fetch(
      `${this.payoutsHost}/api/merchants/${encodeURIComponent(this.payoutMerchantId)}/payouts/${encodeURIComponent(payoutId)}`,
      { headers: { Authorization: `Bearer ${await this.getPayoutToken()}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Peach payout status ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json().catch(() => ({}))) as {
      payoutId?: string;
      status?: string;
      resultCode?: string;
      error?: { code?: string; message?: string };
    };
    return {
      payoutId: json.payoutId ?? payoutId,
      status: String(json.status ?? classifyPayoutCode(json.resultCode)),
      resultCode: json.resultCode,
      error: json.error
        ? `${json.error.code ?? ''} ${json.error.message ?? ''}`.trim()
        : undefined,
    };
  }

  // ─── Bank account verification (BANV / AVS) ───────────────────────
  // POST /api/merchants/{merchantId}/banv — verifies the account exists, is
  // open, and that the SA ID matches the account holder. Result arrives via
  // the banv webhook (or getBankVerificationResult). Runs 03:00–23:00 SAST.
  async verifyBankAccount(req: PeachBanvRequest): Promise<{
    bankVerificationId: string;
    status: string;
    resultCode?: string;
  } | null> {
    if (!this.payoutsConfigured) {
      this.logger.warn(
        'Peach BANV not configured — skipping bank verification',
      );
      return null;
    }
    const accountType = BANV_ACCOUNT_TYPE[req.accountType] ?? 'unknown';
    const res = await fetch(
      `${this.payoutsHost}/api/merchants/${encodeURIComponent(this.payoutMerchantId)}/banv`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.getPayoutToken()}`,
        },
        body: JSON.stringify({
          accountNumber: req.accountNumber,
          accountType,
          branchCode: req.branchCode,
          idNumber: req.idNumber,
          ...(req.initials ? { initials: req.initials.slice(0, 5) } : {}),
          ...(req.lastName ? { lastName: req.lastName.slice(0, 60) } : {}),
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      bankVerificationId?: string;
      status?: string;
      resultCode?: string;
      message?: string;
    };
    if (!res.ok || !json.bankVerificationId) {
      // Never log the request body here — it carries the ID number.
      throw new Error(
        `Peach BANV create ${res.status}: ${json.message ?? json.resultCode ?? ''}`,
      );
    }
    return {
      bankVerificationId: json.bankVerificationId,
      status: json.status ?? 'pending',
      resultCode: json.resultCode,
    };
  }

  /** GET /banv/{id}/status — per-field match flags + lifecycle status. */
  async getBankVerificationResult(
    bankVerificationId: string,
  ): Promise<({ status: string; resultCode?: string } & BanvMatches) | null> {
    if (!this.payoutsConfigured) return null;
    const res = await fetch(
      `${this.payoutsHost}/api/merchants/${encodeURIComponent(this.payoutMerchantId)}/banv/${encodeURIComponent(bankVerificationId)}/status`,
      { headers: { Authorization: `Bearer ${await this.getPayoutToken()}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Peach BANV status ${res.status}: ${await res.text()}`);
    }
    const j = (await res.json()) as Record<string, unknown>;
    return {
      status: this.asString(j.status) ?? 'pending',
      resultCode: j.resultCode as string | undefined,
      accountNumber: j.accountNumber as BanvFlag,
      idNumber: j.idNumber as BanvFlag,
      initials: j.initials as BanvFlag,
      lastName: j.lastName as BanvFlag,
      accountOpen: j.accountOpen as BanvFlag,
      accountAcceptsCredits: j.accountAcceptsCredits as BanvFlag,
    };
  }

  /** Normalise the BANV webhook body (same shape as the status query). */
  parseBanvWebhook(body: Record<string, unknown>): {
    bankVerificationId?: string;
    status: string;
    resultCode?: string;
    matches: BanvMatches;
  } {
    return {
      bankVerificationId: body.bankVerificationId as string | undefined,
      status: this.asString(body.status) ?? 'pending',
      resultCode: body.resultCode as string | undefined,
      matches: {
        accountNumber: body.accountNumber as BanvFlag,
        idNumber: body.idNumber as BanvFlag,
        initials: body.initials as BanvFlag,
        lastName: body.lastName as BanvFlag,
        accountOpen: body.accountOpen as BanvFlag,
        accountAcceptsCredits: body.accountAcceptsCredits as BanvFlag,
      },
    };
  }

  // ─── Webhook verification ─────────────────────────────────────────
  // Two mechanisms per Peach: the newer webhook system signs via headers
  // (x-webhook-signature over `${ts}.${id}.${url}.${rawBody}`); the classic
  // result/webhook carries a `signature` FIELD in the body. Prefer the
  // header method when present, else the field method. Fail-closed in prod.
  verifyWebhookSignature(
    rawBody: string,
    parsedBody: Record<string, unknown>,
    headers: { id?: string; timestamp?: string; signature?: string },
    url: string,
    secretOverride?: string,
  ): boolean {
    const headerSecrets = [
      ...new Set(
        [secretOverride, this.webhookSecret, this.secret].filter(
          (s): s is string => !!s,
        ),
      ),
    ];
    const fieldSecrets = [
      ...new Set(
        [secretOverride, this.secret, this.webhookSecret].filter(
          (s): s is string => !!s,
        ),
      ),
    ];
    if (headerSecrets.length === 0 && fieldSecrets.length === 0) {
      if (this.live || process.env.NODE_ENV === 'production') {
        this.logger.error(
          'PEACH webhook secret unset — rejecting webhook (fail-closed)',
        );
        return false;
      }
      this.logger.warn(
        'PEACH webhook secret unset — accepting webhook (dev only)',
      );
      return true;
    }
    if (headers.signature && headers.id && headers.timestamp) {
      return verifyWebhookHeaderSignature(rawBody, headers, url, headerSecrets);
    }
    if (parsedBody.signature) {
      return fieldSecrets.some((secret) =>
        verifyFieldSignature(parsedBody, secret),
      );
    }
    this.logger.warn('Peach webhook: no signature present — rejecting');
    return false;
  }

  /** Payouts and BANV webhooks are configured under the Payouts product and
   *  can use a different signing secret from Checkout. */
  verifyPayoutWebhookSignature(
    rawBody: string,
    parsedBody: Record<string, unknown>,
    headers: { id?: string; timestamp?: string; signature?: string },
    url: string,
  ): boolean {
    return this.verifyWebhookSignature(
      rawBody,
      parsedBody,
      headers,
      url,
      this.payoutWebhookSecret,
    );
  }

  // Normalise a webhook / shopperResultUrl POST body to the fields the
  // handler needs. Peach checkout webhooks arrive form-urlencoded (nested
  // keys as `result.code`); Payment-Links arrive as JSON (nested objects).
  parseWebhookEvent(body: Record<string, unknown>): {
    checkoutId?: string;
    paymentId?: string;
    merchantReference?: string;
    resultCode?: string;
    bucket: 'success' | 'pending' | 'rejected';
    paymentType?: string;
    amountCents?: number;
  } {
    const flat = (k: string): string | undefined => {
      // form-urlencoded dotted key OR nested object
      if (body[k] !== undefined) return this.asString(body[k]);
      const [head, tail] = k.split('.');
      const obj = body[head];
      if (obj && typeof obj === 'object') {
        const v = (obj as Record<string, unknown>)[tail];
        return v === undefined ? undefined : this.asString(v);
      }
      return undefined;
    };
    const resultCode = flat('result.code');
    return {
      checkoutId: flat('checkoutId'),
      paymentId: flat('id'),
      merchantReference: flat('merchantTransactionId'),
      resultCode,
      bucket: classifyResultCode(resultCode),
      paymentType: flat('paymentType'),
      amountCents:
        flat('amount') !== undefined
          ? this.decimalToCents(flat('amount'))
          : undefined,
    };
  }

  // Payout status webhook: { payoutId, status, resultCode, lastUpdated } —
  // status is Peach's lifecycle enum, passed through verbatim.
  parsePayoutWebhook(body: Record<string, unknown>): {
    payoutId?: string;
    status: string;
    code?: string;
    error?: string;
  } {
    const code =
      (body.resultCode as string | undefined) ??
      (body.result as { code?: string } | undefined)?.code;
    const err = body.error as
      | { title?: string; message?: string; code?: string }
      | undefined;
    return {
      payoutId: body.payoutId as string | undefined,
      status: this.asString(body.status) ?? classifyPayoutCode(code),
      code,
      error: err
        ? `${err.code ?? ''} ${err.title ?? ''} ${err.message ?? ''}`.trim()
        : undefined,
    };
  }
}
