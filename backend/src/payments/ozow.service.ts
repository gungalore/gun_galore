import { Injectable, Logger } from '@nestjs/common';
import {
  verifySvixSignature,
  buildPayoutRequestHash,
  buildPayoutVerifyHash,
  buildPayoutNotificationHash,
  encryptAccountNumber,
  safeEqualHex,
  type SvixHeaders,
} from './ozow-signature';
import { normaliseOzowBank, bankByBranchCode, type OzowBank } from './ozow-banks';

/**
 * OzowService — Ozow Payments adapter (One API pay-in + refunds, Payouts API
 * pay-out), the marketplace money rail (operator decision 2026-09).
 *
 * The public surface keeps the rail-agnostic money engine unchanged:
 *   createPayment / getPaymentStatus / refundPayment / createPayout /
 *   verifyWebhookSignature / parseWebhookEvent / parsePayoutNotification.
 *
 * Contracts verified 2026-09 from hub.ozow.com (One API v1 + Payouts API v1):
 *   ONE API (pay-in + refunds) — OAuth2 client-credentials, bearer token,
 *     Svix-signed webhooks.
 *       live    https://one.ozow.com/v1
 *       staging https://stagingone.ozow.com/v1
 *     POST /token (scope "payments refunds")
 *     POST /payments          → { id, status: "Created", redirectUrl }
 *     GET  /payments/{id}/transactions → { results: Transaction[] }
 *     POST /refunds           → refund a captured transactionId
 *   PAYOUTS API (seller disbursement) — ApiKey + SiteCode headers, SHA-512
 *     hashCheck, AES-256-CBC encrypted account number.
 *       live    https://payoutsapi.ozow.com/v1
 *       staging https://stagingpayoutsapi.ozow.com/v1
 *     GET  /getavailablebanks → bankGroupId + universal branch codes
 *     POST /requestpayout     → { payoutId, payoutStatus }
 *     GET  /getpayout?payoutId=… → payout status
 *
 * AMOUNTS: One API speaks DECIMAL ZAR ("150.00"); the Payouts API request
 * `amount` is also DECIMAL ZAR but the HASH takes integer cents. Our codebase
 * is integer cents throughout, so amounts are converted at this boundary and
 * a decimal must never leak past this file into the database.
 *
 * INERT until configured: with no OZOW_* env the service returns mocks /
 * logs intents and never calls out, so nothing breaks before the operator
 * provisions credentials and flips PAYMENT_MODE=paygate.
 */

export interface OzowCheckout {
  /** Ozow payment id — store it (gatewayCheckoutId). */
  paymentId: string;
  /** Hosted payment URL the buyer is redirected to. */
  redirectUrl: string;
  /** Our merchant reference (stored on gatewayMerchantRef). */
  merchantReference: string;
}

export interface OzowPaymentResult {
  /** Ozow transaction id — the refundable id (stored on gatewayPaymentId). */
  transactionId: string;
  merchantReference: string;
  status: string;
  amountCents: number;
  isSuccess: boolean;
}

export interface OzowPayoutBeneficiary {
  /** The transaction id this payout settles (caller's row). */
  txId: string;
  /** Client-minted payout reference, 1-20 alphanumeric+space. */
  merchantReference: string;
  /** Statement reference for the seller, 1-20 [A-Za-z0-9 -]. */
  customerBankReference: string;
  accountHolder: string;
  bankAccountNumber: string;
  branchCode: string;
  /** Integer ZAR cents. */
  amountCents: number;
  /** Where Ozow posts the payout notification. */
  notifyUrl: string;
}

export interface OzowPayoutResult {
  /** Ozow payoutId (UUID) — store on gatewayPayoutId. Empty = rejected. */
  payoutId: string;
  /** `true` only when payoutId is populated and errorMessage is empty. */
  accepted: boolean;
  status?: number;
  subStatus?: number;
  errorMessage?: string;
}

const ONE_API_LIVE = 'https://one.ozow.com/v1';
const ONE_API_STAGING = 'https://stagingone.ozow.com/v1';
const PAYOUTS_LIVE = 'https://payoutsapi.ozow.com/v1';
const PAYOUTS_STAGING = 'https://stagingpayoutsapi.ozow.com/v1';

@Injectable()
export class OzowService {
  private readonly logger = new Logger(OzowService.name);

  // One API (pay-in + refunds)
  private readonly clientId = process.env.OZOW_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.OZOW_CLIENT_SECRET ?? '';
  private readonly siteCode = process.env.OZOW_SITE_CODE ?? '';
  private readonly webhookSecret = process.env.OZOW_WEBHOOK_SECRET ?? '';

  // Payouts API
  private readonly payoutApiKey = process.env.OZOW_PAYOUT_API_KEY ?? '';
  private readonly payoutSiteCode =
    process.env.OZOW_PAYOUT_SITE_CODE ?? this.siteCode;
  private readonly payoutAccessToken =
    process.env.OZOW_PAYOUT_ACCESS_TOKEN ?? '';
  private readonly payoutEncryptionKey =
    process.env.OZOW_PAYOUT_ENCRYPTION_KEY ?? '';
  private readonly payoutIsRtc = process.env.OZOW_PAYOUT_IS_RTC === 'true';

  private readonly live = process.env.OZOW_ENV === 'live';

  private readonly oneApiHost = this.live ? ONE_API_LIVE : ONE_API_STAGING;
  private readonly payoutsHost = this.live ? PAYOUTS_LIVE : PAYOUTS_STAGING;

  private readonly payInConfigured = !!(
    this.clientId &&
    this.clientSecret &&
    this.siteCode
  );

  private readonly payoutsConfigured = !!(
    this.payoutApiKey &&
    this.payoutSiteCode &&
    this.payoutEncryptionKey
  );

  // Cached bearer token (One API).
  private token: { value: string; expiresAt: number } | null = null;

  // Cached bank list (Payouts API) — branch code → bankGroupId.
  private banksCache: {
    fetchedAt: number;
    byBranch: Map<string, string>;
    byName: Map<string, string>;
  } | null = null;

  constructor() {
    if (!this.payInConfigured) {
      this.logger.warn(
        'Ozow One API not configured (OZOW_CLIENT_ID / OZOW_CLIENT_SECRET / OZOW_SITE_CODE missing) — pay-in runs in MOCK mode; no real charges.',
      );
    }
    if (!this.payoutsConfigured) {
      this.logger.warn(
        'Ozow Payouts not configured (OZOW_PAYOUT_API_KEY / OZOW_PAYOUT_SITE_CODE / OZOW_PAYOUT_ENCRYPTION_KEY missing) — payouts run in MOCK mode.',
      );
    }
    if (this.live && (this.payInConfigured || this.payoutsConfigured)) {
      this.logger.log('Ozow adapter: LIVE mode');
    }
  }

  isPayInConfigured(): boolean {
    return this.payInConfigured;
  }

  isPayoutsConfigured(): boolean {
    return this.payoutsConfigured;
  }

  private centsToDecimal(cents: number): number {
    return Math.round(cents) / 100;
  }
  private decimalToCents(amount: string | number | undefined): number {
    return Math.round(parseFloat(String(amount ?? '0')) * 100);
  }

  // ─── OAuth (One API) ────────────────────────────────────────────────
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.value;
    }
    const res = await fetch(`${this.oneApiHost}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'payments refunds',
        grant_type: 'client_credentials',
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Ozow oauth token ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      accessToken?: string;
      expires_in?: string | number;
      expiresIn?: string | number;
    };
    const value = json.access_token ?? json.accessToken;
    if (!value) throw new Error('Ozow oauth: no access_token in response');
    const ttlSec = Number(json.expires_in ?? json.expiresIn ?? 14400);
    this.token = { value, expiresAt: now + ttlSec * 1000 };
    return value;
  }

  /** 20-char unique merchant reference for pay-in (Ozow allows ≤50; the
   *  Payouts API caps its own at 20, so we keep one shared mint ≤20). */
  private mintMerchantRef(seed: string): string {
    const t = Date.now().toString(36).toUpperCase().slice(-8);
    const tail = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
    return `AO${t}${tail}`.slice(0, 20);
  }

  // ─── Create payment (pay-in) ────────────────────────────────────────
  async createPayment(params: {
    amountZarCents: number;
    merchantTransactionId: string;
    returnUrl: string;
    expirySeconds?: number;
  }): Promise<OzowCheckout> {
    const merchantReference = this.mintMerchantRef(params.merchantTransactionId);

    if (!this.payInConfigured) {
      this.logger.warn('Ozow not configured — returning mock checkout');
      return {
        paymentId: `mock-${merchantReference}`,
        redirectUrl: '',
        merchantReference,
      };
    }

    const expireAt = new Date(
      Date.now() + (params.expirySeconds ?? 24 * 60 * 60) * 1000,
    ).toISOString();

    const body = {
      siteCode: this.siteCode,
      amount: {
        currency: 'ZAR',
        value: this.centsToDecimal(params.amountZarCents),
      },
      merchantReference,
      beneficiaryReference: 'ALLOUTDOOR',
      expireAt,
      returnUrl: params.returnUrl,
    };

    const res = await fetch(`${this.oneApiHost}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ozow createPayment ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      id?: string;
      redirectUrl?: string;
    };
    if (!json.id || !json.redirectUrl) {
      throw new Error('Ozow createPayment missing id/redirectUrl');
    }
    return {
      paymentId: json.id,
      redirectUrl: json.redirectUrl,
      merchantReference,
    };
  }

  // ─── Query payment status (pay-in) ──────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<OzowPaymentResult | null> {
    if (!this.payInConfigured) throw new Error('Ozow not configured');
    const res = await fetch(
      `${this.oneApiHost}/payments/${encodeURIComponent(paymentId)}/transactions`,
      { headers: { Authorization: `Bearer ${await this.getToken()}` } },
    );
    if (!res.ok) {
      throw new Error(`Ozow getPaymentStatus ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      results?: {
        id?: string;
        amount?: { value?: string | number } | string | number;
        merchantReference?: string;
        status?: string;
      }[];
    };
    // An id that matches no payment answers 200 with an empty result list.
    const tx = (json.results ?? [])[0];
    if (!tx) return null;
    const amount =
      typeof tx.amount === 'object' ? tx.amount?.value : tx.amount;
    const status = String(tx.status ?? 'Incomplete');
    return {
      transactionId: tx.id ?? '',
      merchantReference: tx.merchantReference ?? '',
      status,
      amountCents: this.decimalToCents(amount),
      isSuccess: status.toLowerCase() === 'successful',
    };
  }

  // ─── Refund (pay-in reversal) ───────────────────────────────────────
  async refundPayment(
    transactionId: string,
    amountZarCents: number,
    reason = 'REQUESTED_BY_USER',
  ): Promise<{ success: boolean; resultCode?: string; message?: string }> {
    if (!this.payInConfigured) {
      this.logger.warn(
        `Ozow not configured — logging refund intent for ${transactionId} (${amountZarCents}c)`,
      );
      return { success: true, resultCode: 'MOCK_REFUND' };
    }
    const body = {
      transactionId,
      amount: {
        currency: 'ZAR',
        value: this.centsToDecimal(amountZarCents),
      },
      reason,
    };
    const res = await fetch(`${this.oneApiHost}/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getToken()}`,
      },
      body: JSON.stringify([body]),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ok = res.status === 200 || res.status === 201;
    if (!ok) {
      this.logger.warn(
        `Ozow refund ${transactionId} failed (${res.status}): ${JSON.stringify(json)}`,
      );
    }
    return {
      success: ok,
      resultCode: String(res.status),
      message: typeof json.detail === 'string' ? json.detail : undefined,
    };
  }

  // ─── Bank list (Payouts API) ────────────────────────────────────────
  /** Cache GET /getavailablebanks for an hour; maps branch code + name → id. */
  private async availableBanks(): Promise<{
    byBranch: Map<string, string>;
    byName: Map<string, string>;
  }> {
    const now = Date.now();
    if (this.banksCache && now - this.banksCache.fetchedAt < 60 * 60 * 1000) {
      return this.banksCache;
    }
    const byBranch = new Map<string, string>();
    const byName = new Map<string, string>();
    if (this.payoutsConfigured) {
      try {
        const res = await fetch(`${this.payoutsHost}/getavailablebanks`, {
          headers: {
            SiteCode: this.payoutSiteCode,
            ApiKey: this.payoutApiKey,
          },
        });
        if (res.ok) {
          const list = (await res.json()) as {
            bankGroupId?: string;
            bankGroupName?: string;
            universalBranchCode?: string;
          }[];
          for (const b of list) {
            if (!b.bankGroupId) continue;
            if (b.universalBranchCode) byBranch.set(b.universalBranchCode, b.bankGroupId);
            if (b.bankGroupName)
              byName.set(b.bankGroupName.toLowerCase().replace(/[^a-z]/g, ''), b.bankGroupId);
          }
        }
      } catch (err) {
        this.logger.warn(`Ozow getavailablebanks failed: ${(err as Error).message}`);
      }
    }
    this.banksCache = { fetchedAt: now, byBranch, byName };
    return this.banksCache;
  }

  async resolveBankGroupId(bank: OzowBank): Promise<string | null> {
    const banks = await this.availableBanks();
    return (
      banks.byBranch.get(bank.universalBranchCode) ??
      banks.byName.get(bank.groupName.toLowerCase().replace(/[^a-z]/g, '')) ??
      null
    );
  }

  // ─── Create payout (seller disbursement) ────────────────────────────
  async createPayout(
    beneficiary: OzowPayoutBeneficiary,
  ): Promise<OzowPayoutResult> {
    if (!this.payoutsConfigured) {
      this.logger.warn(
        `Ozow payouts not configured — logging payout intent for ${beneficiary.txId} (${beneficiary.amountCents}c)`,
      );
      return { payoutId: '', accepted: false, errorMessage: 'payouts not configured' };
    }

    const bank = bankByBranchCode(beneficiary.branchCode);
    if (!bank) {
      return {
        payoutId: '',
        accepted: false,
        errorMessage: `Unrecognised branch code ${beneficiary.branchCode}`,
      };
    }
    const bankGroupId = await this.resolveBankGroupId(bank);
    if (!bankGroupId) {
      return {
        payoutId: '',
        accepted: false,
        errorMessage: `No Ozow bank group for ${bank.groupName}`,
      };
    }

    const encryptedAccountNumber = encryptAccountNumber(
      beneficiary.bankAccountNumber,
      this.payoutEncryptionKey,
      beneficiary.merchantReference,
      beneficiary.amountCents,
    );

    const hashCheck = buildPayoutRequestHash({
      siteCode: this.payoutSiteCode,
      amountCents: beneficiary.amountCents,
      merchantReference: beneficiary.merchantReference,
      customerBankReference: beneficiary.customerBankReference,
      isRtc: this.payoutIsRtc,
      notifyUrl: beneficiary.notifyUrl,
      bankGroupId,
      encryptedAccountNumber,
      branchCode: beneficiary.branchCode,
      apiKey: this.payoutApiKey,
    });

    const res = await fetch(`${this.payoutsHost}/requestpayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
      body: JSON.stringify({
        siteCode: this.payoutSiteCode,
        amount: this.centsToDecimal(beneficiary.amountCents),
        merchantReference: beneficiary.merchantReference,
        customerBankReference: beneficiary.customerBankReference,
        isRtc: this.payoutIsRtc,
        notifyUrl: beneficiary.notifyUrl,
        bankingDetails: {
          bankGroupId,
          accountNumber: encryptedAccountNumber,
          branchCode: beneficiary.branchCode,
        },
        hashCheck,
      }),
    });

    if (!res.ok) {
      const message = await res.text().catch(() => '');
      this.logger.warn(`Ozow requestpayout ${res.status}: ${message}`);
      return { payoutId: '', accepted: false, errorMessage: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as {
      payoutId?: string;
      payoutStatus?: {
        status?: number;
        subStatus?: number;
        errorMessage?: string;
      };
    };
    const payoutId = json.payoutId ?? '';
    const errorMessage = json.payoutStatus?.errorMessage ?? '';
    return {
      payoutId,
      accepted: !!payoutId && !errorMessage,
      status: json.payoutStatus?.status,
      subStatus: json.payoutStatus?.subStatus,
      errorMessage,
    };
  }

  // ─── Webhook helpers ────────────────────────────────────────────────

  verifyWebhookSignature(
    rawBody: string,
    headers: SvixHeaders,
  ): boolean {
    if (!this.webhookSecret) {
      if (this.live || process.env.NODE_ENV === 'production') {
        this.logger.error('OZOW_WEBHOOK_SECRET unset — rejecting webhook (fail-closed)');
        return false;
      }
      this.logger.warn('OZOW_WEBHOOK_SECRET unset — accepting webhook (dev only)');
      return true;
    }
    return verifySvixSignature(this.webhookSecret, headers, rawBody);
  }

  /** Normalise a `transaction.complete` delivery to a flat shape. */
  parseTransactionWebhook(data: Record<string, unknown>): {
    transactionId?: string;
    merchantReference?: string;
    status: string;
    amountCents?: number;
  } {
    const first = (k: string): string | undefined => {
      const v = data[k];
      return v === undefined || v === null ? undefined : String(v);
    };
    return {
      transactionId: first('TransactionId') ?? first('id'),
      merchantReference: first('TransactionReference') ?? first('merchantReference'),
      status: first('Status') ?? first('status') ?? 'Incomplete',
      amountCents:
        first('Amount') !== undefined ? this.decimalToCents(first('Amount')) : undefined,
    };
  }

  /** Normalise a payout notification body to flat fields + verified hash. */
  parsePayoutNotification(body: Record<string, unknown>): {
    payoutId?: string;
    merchantReference?: string;
    status: number;
    subStatus: number;
    errorMessage: string;
  } {
    const ps = (body.payoutStatus ?? body.PayoutStatus ?? {}) as Record<string, unknown>;
    const status = Number(ps.status ?? body.status ?? 0);
    const subStatus = Number(ps.subStatus ?? body.subStatus ?? 0);
    return {
      payoutId: String(body.payoutId ?? body.PayoutId ?? ''),
      merchantReference: String(body.merchantReference ?? body.MerchantReference ?? ''),
      status,
      subStatus,
      errorMessage: String(ps.errorMessage ?? body.errorMessage ?? ''),
    };
  }

  /** Verify a payout notification hash (SHA-512, lowercased, apiKey-appended). */
  verifyPayoutNotificationHash(body: Record<string, unknown>): boolean {
    if (!this.payoutApiKey) return false;
    const ps = (body.payoutStatus ?? body.PayoutStatus ?? {}) as Record<string, unknown>;
    const status = Number(ps.status ?? body.status ?? 0);
    const subStatus = Number(ps.subStatus ?? body.subStatus ?? 0);
    const expected = buildPayoutNotificationHash({
      payoutId: String(body.payoutId ?? body.PayoutId ?? ''),
      siteCode: this.payoutSiteCode,
      merchantReference: String(body.merchantReference ?? body.MerchantReference ?? ''),
      customerMerchantReference: String(
        body.customerMerchantReference ?? body.CustomerMerchantReference ?? '',
      ),
      status,
      subStatus,
      apiKey: this.payoutApiKey,
    });
    const provided = String(body.hashCheck ?? body.HashCheck ?? '');
    return !!provided && safeEqualHex(expected, provided);
  }

  /** Verify the pre-dispersal payout verification webhook hash. */
  verifyPayoutVerifyHash(body: Record<string, unknown>): boolean {
    if (!this.payoutApiKey) return false;
    const banking = (body.bankingDetails ?? body.BankingDetails ?? {}) as Record<string, unknown>;
    const amountCents = Math.round(parseFloat(String(body.amount ?? '0')) * 100);
    const isRtc = String(body.isRtc ?? body.IsRtc ?? 'false').toLowerCase() === 'true';
    const expected = buildPayoutVerifyHash({
      payoutId: String(body.payoutId ?? body.PayoutId ?? ''),
      siteCode: this.payoutSiteCode,
      amountCents,
      merchantReference: String(body.merchantReference ?? body.MerchantReference ?? ''),
      customerBankReference: String(body.customerBankReference ?? body.CustomerBankReference ?? ''),
      isRtc,
      notifyUrl: String(body.notifyUrl ?? body.NotifyUrl ?? ''),
      bankGroupId: String(banking.bankGroupId ?? banking.BankGroupId ?? ''),
      encryptedAccountNumber: String(banking.accountNumber ?? banking.AccountNumber ?? ''),
      branchCode: String(banking.branchCode ?? banking.BranchCode ?? ''),
      apiKey: this.payoutApiKey,
    });
    const provided = String(body.hashCheck ?? body.HashCheck ?? '');
    return !!provided && safeEqualHex(expected, provided);
  }

  /** The per-request AES key Ozow expects back on a verified payout. */
  payoutDecryptionKey(): string {
    return this.payoutEncryptionKey;
  }

  isPayoutAccessTokenValid(token: string | undefined): boolean {
    return !!this.payoutAccessToken && token === this.payoutAccessToken;
  }

  /** Re-exported for the verification-webhook handler. */
  static normaliseBank(raw: string | null | undefined) {
    return normaliseOzowBank(raw);
  }
}
