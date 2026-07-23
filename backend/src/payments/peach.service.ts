import { Injectable, Logger } from '@nestjs/common';
import {
  signParams,
  verifyFieldSignature,
  verifyWebhookHeaderSignature,
  classifyResultCode,
  classifyPayoutCode,
} from './peach-signature';

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
 *     POST {payouts}/api/payouts  (Bearer) — batch payouts[] array.
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
  /** Our internal id echoed back on the payout webhook (merchantPayoutId). */
  reference: string;
  beneficiaryName: string;
  bankAccountNumber: string;
  branchCode: string;
  amountCents: number;
  /** Free-text that appears on the beneficiary's statement (≤20 chars). */
  narrative?: string;
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

  // OAuth client-credentials, from the Dashboard (Checkout + Payouts share
  // the same auth service; entityId/secret are per-product).
  private readonly clientId = process.env.PEACH_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.PEACH_CLIENT_SECRET ?? '';
  private readonly merchantId = process.env.PEACH_MERCHANT_ID ?? '';
  private readonly entityId = process.env.PEACH_ENTITY_ID ?? '';
  // Signing secret ("secret token") for checkout create + refund + result
  // signature verification.
  private readonly secret = process.env.PEACH_SECRET ?? '';
  // Payouts is a separately-onboarded product with its own entity + creds.
  private readonly payoutEntityId = process.env.PEACH_PAYOUT_ENTITY_ID ?? '';

  private readonly live = process.env.PEACH_ENV === 'live';

  private readonly authHost = this.live ? AUTH_HOST_LIVE : AUTH_HOST_SBX;
  private readonly checkoutHost = this.live ? CHECKOUT_HOST_LIVE : CHECKOUT_HOST_SBX;
  private readonly refundHost = this.live ? REFUND_HOST_LIVE : REFUND_HOST_SBX;
  private readonly payoutsHost = this.live ? PAYOUTS_HOST_LIVE : PAYOUTS_HOST_SBX;

  // Checkout is "configured" once we can both authenticate and sign.
  private readonly isConfigured = !!(
    this.clientId &&
    this.clientSecret &&
    this.merchantId &&
    this.entityId &&
    this.secret
  );
  private readonly payoutsConfigured = !!(
    this.clientId &&
    this.clientSecret &&
    this.merchantId &&
    this.payoutEntityId
  );

  // Cached bearer token (shared by checkout status + payouts).
  private token: { value: string; expiresAt: number } | null = null;

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
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.value;
    }
    const res = await fetch(`${this.authHost}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        merchantId: this.merchantId,
      }),
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
    this.token = { value, expiresAt: now + ttlSec * 1000 };
    return value;
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
    const tail = txId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
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
    const merchantReference = this.mintMerchantRef(params.merchantTransactionId);

    if (!this.isConfigured) {
      this.logger.warn('Peach not configured — returning mock checkout');
      return {
        paymentId: `mock-${merchantReference}`,
        redirectUrl: '',
        merchantReference,
      };
    }

    // Fields that participate in the signature (flat + signed per Peach).
    const signed: Record<string, unknown> = {
      authentication: { entityId: this.entityId },
      merchantTransactionId: merchantReference,
      amount: this.centsToDecimal(params.amountZarCents),
      currency: 'ZAR',
      nonce: this.nonce(),
      shopperResultUrl: params.shopperResultUrl,
    };
    if (params.notificationUrl) signed.notificationUrl = params.notificationUrl;
    if (params.cancelUrl) signed.cancelUrl = params.cancelUrl;
    const signature = signParams(signed, this.secret);

    const res = await fetch(`${this.checkoutHost}/v2/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
      },
      body: JSON.stringify({ ...signed, signature }),
    });
    if (!res.ok) {
      throw new Error(`Peach createCheckout ${res.status}: ${await res.text()}`);
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
      throw new Error(`Peach getPaymentStatus ${res.status}: ${await res.text()}`);
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
    _reason: PeachRefundReason = 'REQUESTED_BY_USER',
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
  // Real per-seller third-party disbursement (unlike the old Stitch
  // "withdrawal" which only moved OUR balance to OUR bank). Batch-capable;
  // callers pass one or many beneficiaries.
  async createPayout(
    beneficiaries: PeachPayoutBeneficiary[],
  ): Promise<{
    success: boolean;
    requestId?: string;
    results: { reference: string; payoutId?: string; status: string; code?: string }[];
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
          reference: b.reference,
          status: 'not_configured',
        })),
        message: 'payouts not configured',
      };
    }
    const res = await fetch(`${this.payoutsHost}/api/payouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
      },
      body: JSON.stringify({
        entityId: this.payoutEntityId,
        payouts: beneficiaries.map((b) => ({
          merchantPayoutId: b.reference,
          amount: this.centsToDecimal(b.amountCents),
          currency: 'ZAR',
          beneficiaryName: b.beneficiaryName,
          bankAccountNumber: b.bankAccountNumber,
          // Peach recommends the UNIVERSAL branch code; the caller passes
          // the seller's stored branch code and we send it as-is.
          branchCode: b.branchCode,
          reference: (b.narrative ?? 'Gun Galore payout').slice(0, 20),
        })),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      requestId?: string;
      payouts?: {
        merchantPayoutId?: string;
        payoutId?: string;
        result?: { code?: string };
      }[];
      result?: { code?: string; description?: string };
    };
    if (!res.ok) {
      this.logger.warn(
        `Peach createPayout ${res.status}: ${json.result?.description ?? ''}`,
      );
      return {
        success: false,
        results: beneficiaries.map((b) => ({
          reference: b.reference,
          status: 'failed',
          code: String(res.status),
        })),
        message: json.result?.description,
      };
    }
    const results = (json.payouts ?? []).map((p) => {
      const status = classifyPayoutCode(p.result?.code);
      return {
        reference: p.merchantPayoutId ?? '',
        payoutId: p.payoutId,
        status,
        code: p.result?.code,
      };
    });
    // Success = the batch was ACCEPTED (processing/success); individual
    // failures are surfaced per-row for the caller to reconcile.
    return { success: true, requestId: json.requestId, results };
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
  ): boolean {
    if (!this.secret) {
      if (this.live || process.env.NODE_ENV === 'production') {
        this.logger.error('PEACH_SECRET unset — rejecting webhook (fail-closed)');
        return false;
      }
      this.logger.warn('PEACH_SECRET unset — accepting webhook (dev only)');
      return true;
    }
    if (headers.signature && headers.id && headers.timestamp) {
      return verifyWebhookHeaderSignature(rawBody, headers, url, this.secret);
    }
    if (parsedBody.signature) {
      return verifyFieldSignature(parsedBody, this.secret);
    }
    this.logger.warn('Peach webhook: no signature present — rejecting');
    return false;
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
      if (body[k] !== undefined) return String(body[k]);
      const [head, tail] = k.split('.');
      const obj = body[head];
      if (obj && typeof obj === 'object') {
        const v = (obj as Record<string, unknown>)[tail];
        return v === undefined ? undefined : String(v);
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

  parsePayoutWebhook(body: Record<string, unknown>): {
    merchantPayoutId?: string;
    payoutId?: string;
    status: 'success' | 'processing' | 'failed';
    code?: string;
  } {
    const code =
      (body.result as { code?: string } | undefined)?.code ??
      (body['result.code'] as string | undefined);
    return {
      merchantPayoutId:
        (body.merchantPayoutId as string) ?? (body.reference as string),
      payoutId: body.payoutId as string,
      status: classifyPayoutCode(code),
      code,
    };
  }
}
