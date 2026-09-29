import { Injectable, Logger } from '@nestjs/common';
import {
  verifySvixSignature,
  buildPayoutRequestHash,
  buildPayoutVerifyHash,
  buildPayoutNotificationHash,
  encryptAccountNumber,
  generatePayoutEncryptionKey,
  safeEqualHex,
  unwrapPayoutEncryptionKey,
  wrapPayoutEncryptionKey,
  type WrappedPayoutEncryptionKey,
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
  attemptId?: string;
  status?: number;
  subStatus?: number;
  errorMessage?: string;
}

export interface OzowPayoutAttemptMaterial extends WrappedPayoutEncryptionKey {
  txId: string;
  siteCode: string;
  merchantReference: string;
  customerBankReference: string;
  amountCents: number;
  isRtc: boolean;
  notifyUrl: string;
  bankGroupId: string;
  encryptedAccountNumber: string;
  branchCode: string;
}

export interface OzowPayoutStatus {
  payoutId: string;
  status: number;
  subStatus: number;
  errorMessage: string;
}

export interface OzowPayoutReferenceResult extends OzowPayoutStatus {
  merchantReference: string;
  customerBankReference: string;
  amountCents: number;
  siteCode: string;
  isRtc: boolean;
}

/**
 * Mock-scenario switches for the Payouts mock environment. Ozow's money-out
 * test cases require exactly ONE of these set `true` at a time (all others
 * false), reset between scenarios.
 */
export interface OzowPayoutTestConfiguration {
  IsAccountDecryptionFailed?: boolean;
  IsNotVerifiedResponse?: boolean;
  IsAccountDecryptionKeyMissing?: boolean;
  [key: string]: unknown;
}

/** One bank as returned by GET /getavailablebanks. */
export interface OzowAvailableBank {
  bankGroupId: string;
  bankGroupName: string;
  universalBranchCode: string;
}

const ONE_API_LIVE = 'https://one.ozow.com/v1';
const ONE_API_STAGING = 'https://stagingone.ozow.com/v1';
const PAYOUTS_LIVE = 'https://payoutsapi.ozow.com/v1';
const PAYOUTS_STAGING = 'https://stagingpayoutsapi.ozow.com/v1';
// Mock bases simulate payout failure scenarios without touching the float.
// Never reachable in live mode (see assertPayoutMockAllowed).
const PAYOUTS_LIVE_MOCK = 'https://payoutsapi.ozow.com/mock/v1';
const PAYOUTS_STAGING_MOCK = 'https://stagingpayoutsapi.ozow.com/mock/v1';

function webhookText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function webhookNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function webhookRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
  private readonly payoutSiteCode = process.env.OZOW_PAYOUT_SITE_CODE ?? '';
  private readonly payoutAccessToken =
    process.env.OZOW_PAYOUT_ACCESS_TOKEN ?? '';
  // Master secret used only to wrap unique per-request payout keys at rest.
  private readonly payoutKeyWrappingSecret =
    process.env.OZOW_PAYOUT_ENCRYPTION_KEY ?? '';
  private readonly payoutIsRtc =
    process.env.OZOW_ENV === 'live' && process.env.OZOW_PAYOUT_IS_RTC === 'true';

  private readonly live = process.env.OZOW_ENV === 'live';

  private readonly oneApiHost = this.live ? ONE_API_LIVE : ONE_API_STAGING;
  private readonly payoutsHost = this.live ? PAYOUTS_LIVE : PAYOUTS_STAGING;
  private readonly payoutsMockHost = this.live
    ? PAYOUTS_LIVE_MOCK
    : PAYOUTS_STAGING_MOCK;
  // Mock payouts are an explicit, non-live-only opt-in: both gates must pass
  // before the mock host is ever used. There is no accidental path to it.
  private readonly payoutMockEnabled =
    !this.live && process.env.OZOW_PAYOUT_MOCK === 'true';

  private readonly payInConfigured = !!(
    this.clientId &&
    this.clientSecret &&
    this.siteCode
  );

  private readonly payoutsConfigured = !!(
    this.payoutApiKey &&
    this.payoutSiteCode &&
    this.payoutKeyWrappingSecret &&
    this.payoutKeyWrappingSecret.length >= 32 &&
    this.payoutAccessToken
  );

  // Cached bearer token (One API).
  private token: { value: string; expiresAt: number } | null = null;

  // Cached bank list (Payouts API) — branch code → bankGroupId, plus the raw
  // list so the test harness can target a bank Ozow knows but our static seller
  // list does not (e.g. staging's Ozow Demo Bank).
  private banksCache: {
    fetchedAt: number;
    byBranch: Map<string, string>;
    byName: Map<string, string>;
    raw: OzowAvailableBank[];
  } | null = null;

  constructor() {
    if (!this.payInConfigured) {
      this.logger.warn(
        'Ozow One API not configured (OZOW_CLIENT_ID / OZOW_CLIENT_SECRET / OZOW_SITE_CODE missing) — pay-in runs in MOCK mode; no real charges.',
      );
    }
    if (!this.payoutsConfigured) {
      this.logger.warn(
        'Ozow Payouts not configured (payout API key, site code, verification access token, or key-wrapping secret missing) — no payout requests will be sent.',
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

  isPayoutMockEnabled(): boolean {
    return this.payoutMockEnabled;
  }

  private assertPayoutMockAllowed(): void {
    if (this.live) {
      throw new Error('Ozow mock payouts are disabled in live mode');
    }
    if (!this.payoutMockEnabled) {
      throw new Error(
        'Ozow mock payouts require OZOW_PAYOUT_MOCK=true in a non-live environment',
      );
    }
  }

  private payoutsBase(mock: boolean): string {
    if (mock) {
      this.assertPayoutMockAllowed();
      return this.payoutsMockHost;
    }
    return this.payoutsHost;
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
        // The merchant reference is unique per checkout and reused on any retry
        // of the same payment, which is exactly the idempotency contract Ozow
        // recommends: a retried POST returns the original payment, never a
        // second one.
        'Idempotency-Key': merchantReference,
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
        // A refund is irreversible: key it on the transaction + amount so a
        // retried call cannot issue a second refund for the same slice.
        'Idempotency-Key': `AO-REFUND-${transactionId}-${Math.round(amountZarCents)}`,
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
    raw: OzowAvailableBank[];
  }> {
    const now = Date.now();
    if (this.banksCache && now - this.banksCache.fetchedAt < 60 * 60 * 1000) {
      return this.banksCache;
    }
    const byBranch = new Map<string, string>();
    const byName = new Map<string, string>();
    const raw: OzowAvailableBank[] = [];
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
            const entry: OzowAvailableBank = {
              bankGroupId: b.bankGroupId,
              bankGroupName: b.bankGroupName ?? '',
              universalBranchCode: b.universalBranchCode ?? '',
            };
            raw.push(entry);
            if (b.universalBranchCode) byBranch.set(b.universalBranchCode, b.bankGroupId);
            if (b.bankGroupName)
              byName.set(b.bankGroupName.toLowerCase().replace(/[^a-z]/g, ''), b.bankGroupId);
          }
        }
      } catch (err) {
        this.logger.warn(`Ozow getavailablebanks failed: ${(err as Error).message}`);
      }
    }
    this.banksCache = { fetchedAt: now, byBranch, byName, raw };
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

  /** Every bank Ozow lists for the configured payouts site. */
  async getAvailableBanks(): Promise<OzowAvailableBank[]> {
    return (await this.availableBanks()).raw;
  }

  /**
   * Resolve a payout destination from Ozow's LIVE bank list by bank name or
   * universal branch code. This lets the test harness pay to a staging bank
   * Ozow offers but our static seller list does not — notably **Ozow Demo
   * Bank**, which is the only staging destination that does not move real
   * money. Real seller payouts keep the static-list gate in createPayout.
   */
  async resolvePayoutBank(input: {
    bankName?: string;
    branchCode?: string;
  }): Promise<OzowAvailableBank | null> {
    const list = await this.getAvailableBanks();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const code = input.branchCode?.trim();
    if (code) {
      const hit = list.find((b) => b.universalBranchCode === code);
      if (hit) return hit;
    }
    const name = input.bankName?.trim();
    if (name) {
      const key = norm(name);
      return (
        list.find((b) => norm(b.bankGroupName) === key) ??
        list.find((b) => norm(b.bankGroupName).includes(key)) ??
        list.find((b) => key.includes(norm(b.bankGroupName))) ??
        null
      );
    }
    return null;
  }

  // ─── Create payout (seller disbursement) ────────────────────────────
  // `options.mock` routes this ONE request at the mock host (non-live only),
  // used by the Ozow test-case harness. `options.resolvedBank` lets the harness
  // pass a bank resolved from Ozow's LIVE list (e.g. Ozow Demo Bank) instead of
  // the static seller list; the seller-payout runner never sets either.
  async createPayout(
    beneficiary: OzowPayoutBeneficiary,
    persistAttempt: (material: OzowPayoutAttemptMaterial) => Promise<string>,
    options: {
      mock?: boolean;
      resolvedBank?: { bankGroupId: string; branchCode: string };
    } = {},
  ): Promise<OzowPayoutResult> {
    if (!this.payoutsConfigured) {
      this.logger.warn(
        `Ozow payouts not configured — logging payout intent for ${beneficiary.txId} (${beneficiary.amountCents}c)`,
      );
      return { payoutId: '', accepted: false, errorMessage: 'payouts not configured' };
    }

    let notifyUrl: URL;
    try {
      notifyUrl = new URL(beneficiary.notifyUrl);
    } catch {
      return {
        payoutId: '',
        accepted: false,
        errorMessage: 'Payout notification URL must be a public HTTPS URL',
      };
    }
    const notifyHost = notifyUrl.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    if (
      notifyUrl.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '::1'].includes(notifyHost) ||
      notifyHost.endsWith('.local') ||
      beneficiary.notifyUrl.length > 150
    ) {
      return {
        payoutId: '',
        accepted: false,
        errorMessage: 'Payout notification URL must be a public HTTPS URL',
      };
    }

    let bankGroupId: string;
    let branchCode = beneficiary.branchCode;
    if (options.resolvedBank) {
      bankGroupId = options.resolvedBank.bankGroupId;
      branchCode = options.resolvedBank.branchCode;
    } else {
      const bank = bankByBranchCode(beneficiary.branchCode);
      if (!bank) {
        return {
          payoutId: '',
          accepted: false,
          errorMessage: `Unrecognised branch code ${beneficiary.branchCode}`,
        };
      }
      const resolved = await this.resolveBankGroupId(bank);
      if (!resolved) {
        return {
          payoutId: '',
          accepted: false,
          errorMessage: `No Ozow bank group for ${bank.groupName}`,
        };
      }
      bankGroupId = resolved;
    }

    const payoutEncryptionKey = generatePayoutEncryptionKey();
    const wrappedKey = wrapPayoutEncryptionKey(
      payoutEncryptionKey,
      this.payoutKeyWrappingSecret,
    );
    const encryptedAccountNumber = encryptAccountNumber(
      beneficiary.bankAccountNumber,
      payoutEncryptionKey,
      beneficiary.merchantReference,
      beneficiary.amountCents,
    );

    // Persist the encrypted, unique key and exact signed request fields before
    // contacting Ozow. The verification callback arrives after requestpayout
    // returns and must use this attempt, never mutable seller profile data.
    const attemptId = await persistAttempt({
      txId: beneficiary.txId,
      siteCode: this.payoutSiteCode,
      merchantReference: beneficiary.merchantReference,
      customerBankReference: beneficiary.customerBankReference,
      amountCents: beneficiary.amountCents,
      isRtc: this.payoutIsRtc,
      notifyUrl: beneficiary.notifyUrl,
      bankGroupId,
      encryptedAccountNumber,
      branchCode,
      ...wrappedKey,
    });

    const hashCheck = buildPayoutRequestHash({
      siteCode: this.payoutSiteCode,
      amountCents: beneficiary.amountCents,
      merchantReference: beneficiary.merchantReference,
      customerBankReference: beneficiary.customerBankReference,
      isRtc: this.payoutIsRtc,
      notifyUrl: beneficiary.notifyUrl,
      bankGroupId,
      encryptedAccountNumber,
      branchCode,
      apiKey: this.payoutApiKey,
    });

    const res = await fetch(`${this.payoutsBase(options.mock === true)}/requestpayout`, {
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
          branchCode,
        },
        hashCheck,
      }),
    });

    if (!res.ok) {
      // A transport failure (400/403/500) carries Ozow's reason in a flat
      // `message` field, not in `payoutStatus`. Surface it so the admin hold
      // reason and the test harness evidence say what actually went wrong.
      const raw = await res.text().catch(() => '');
      let providerMessage = '';
      try {
        const parsed = JSON.parse(raw) as { message?: unknown };
        if (typeof parsed.message === 'string') providerMessage = parsed.message;
      } catch {
        providerMessage = raw;
      }
      const message = providerMessage || `HTTP ${res.status}`;
      this.logger.warn(`Ozow requestpayout ${res.status}: ${message}`);
      return {
        payoutId: '',
        accepted: false,
        attemptId,
        errorMessage: message,
      };
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
      attemptId,
      accepted: !!payoutId && !errorMessage,
      status: json.payoutStatus?.status,
      subStatus: json.payoutStatus?.subStatus,
      errorMessage,
    };
  }

  /** Query the authoritative payout outcome after a notification is delayed. */
  async getPayoutStatus(payoutId: string): Promise<OzowPayoutStatus> {
    if (!this.payoutsConfigured) throw new Error('Ozow payouts not configured');
    const url = new URL(`${this.payoutsHost}/getpayout`);
    url.searchParams.set('payoutId', payoutId);
    const res = await fetch(url, {
      headers: {
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Ozow getpayout ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      id?: string;
      payoutId?: string;
      payoutStatus?: {
        status?: number;
        subStatus?: number;
        errorMessage?: string;
      };
    };
    if (!json.payoutStatus || json.payoutStatus.status === undefined) {
      throw new Error('Ozow getpayout response is missing payoutStatus.status');
    }
    return {
      payoutId: json.id ?? json.payoutId ?? payoutId,
      status: Number(json.payoutStatus.status),
      subStatus: Number(json.payoutStatus.subStatus ?? 0),
      errorMessage: String(json.payoutStatus.errorMessage ?? ''),
    };
  }

  /** Find payouts by the client-minted reference when the request response was lost. */
  async getPayoutsByReference(
    merchantReference: string,
  ): Promise<OzowPayoutReferenceResult[]> {
    if (!this.payoutsConfigured) throw new Error('Ozow payouts not configured');
    const res = await fetch(`${this.payoutsHost}/getpayoutbyreference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
      body: JSON.stringify({
        pageSize: 10,
        pageIndex: 1,
        searchFields: [1],
        searchString: merchantReference,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ozow getpayoutbyreference ${res.status}: ${await res.text()}`);
    }
    const payouts = (await res.json()) as {
      id?: string;
      amount?: string | number;
      merchantReference?: string;
      customerBankReference?: string;
      siteCode?: string;
      isRtc?: boolean;
      payoutStatus?: {
        status?: number;
        subStatus?: number;
        errorMessage?: string;
      };
    }[];
    return payouts.map((payout) => ({
      payoutId: String(payout.id ?? ''),
      merchantReference: String(payout.merchantReference ?? ''),
      customerBankReference: String(payout.customerBankReference ?? ''),
      amountCents: this.decimalToCents(payout.amount),
      siteCode: String(payout.siteCode ?? ''),
      isRtc: payout.isRtc === true,
      status: Number(payout.payoutStatus?.status ?? 0),
      subStatus: Number(payout.payoutStatus?.subStatus ?? 0),
      errorMessage: String(payout.payoutStatus?.errorMessage ?? ''),
    }));
  }

  // ─── Mock / test configuration (Payouts API, non-live only) ─────────
  // These drive Ozow's mandatory mock test cases (money-out tests 1–3). They
  // are refused unless OZOW_PAYOUT_MOCK=true AND the environment is not live.

  /** GET /mock/v1/gettestconfiguration — the current mock scenario switches. */
  async getPayoutTestConfiguration(): Promise<OzowPayoutTestConfiguration> {
    this.assertPayoutMockAllowed();
    if (!this.payoutsConfigured) throw new Error('Ozow payouts not configured');
    const url = new URL(`${this.payoutsMockHost}/gettestconfiguration`);
    url.searchParams.set('siteCode', this.payoutSiteCode);
    const res = await fetch(url, {
      headers: {
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Ozow gettestconfiguration ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json()) as OzowPayoutTestConfiguration;
  }

  /**
   * POST /mock/v1/settestconfiguration — force ONE mock scenario. Set exactly
   * one flag true (all others false) and reset between scenarios.
   */
  async setPayoutTestConfiguration(
    config: OzowPayoutTestConfiguration,
  ): Promise<OzowPayoutTestConfiguration> {
    this.assertPayoutMockAllowed();
    if (!this.payoutsConfigured) throw new Error('Ozow payouts not configured');
    const res = await fetch(`${this.payoutsMockHost}/settestconfiguration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
      body: JSON.stringify({ siteCode: this.payoutSiteCode, ...config }),
    });
    if (!res.ok) {
      throw new Error(
        `Ozow settestconfiguration ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json().catch(() => ({}))) as OzowPayoutTestConfiguration;
  }

  /** GET /mock/v1/getpayout — the simulated mock payout result. */
  async getMockPayout(payoutId: string): Promise<Record<string, unknown>> {
    this.assertPayoutMockAllowed();
    if (!this.payoutsConfigured) throw new Error('Ozow payouts not configured');
    const url = new URL(`${this.payoutsMockHost}/getpayout`);
    url.searchParams.set('payoutId', payoutId);
    url.searchParams.set('siteCode', this.payoutSiteCode);
    const res = await fetch(url, {
      headers: {
        SiteCode: this.payoutSiteCode,
        ApiKey: this.payoutApiKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Ozow getMockPayout ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  decryptPayoutEncryptionKey(
    wrapped: WrappedPayoutEncryptionKey,
  ): string {
    return unwrapPayoutEncryptionKey(wrapped, this.payoutKeyWrappingSecret);
  }

  /** Compare every signed verification field with the durable request record. */
  matchesPayoutVerification(
    body: Record<string, unknown>,
    expected: OzowPayoutAttemptMaterial,
  ): boolean {
    const banking = webhookRecord(body.bankingDetails ?? body.BankingDetails);
    const value = (lower: string, upper: string) => body[lower] ?? body[upper];
    const sameText = (actual: unknown, wanted: string) =>
      (webhookText(actual) ?? '').toLowerCase() === wanted.toLowerCase();
    const amount = webhookNumber(value('amount', 'Amount'));
    if (amount === undefined) return false;
    const amountCents = Math.round(amount * 100);
    const actualRtc = value('isRtc', 'IsRtc');
    if (actualRtc === undefined || actualRtc === null) return false;
    if (typeof actualRtc !== 'boolean' && typeof actualRtc !== 'string') return false;
    const isRtc = actualRtc === true || actualRtc === 'true';
    return (
      sameText(value('siteCode', 'SiteCode'), expected.siteCode) &&
      sameText(value('merchantReference', 'MerchantReference'), expected.merchantReference) &&
      sameText(value('customerBankReference', 'CustomerBankReference'), expected.customerBankReference) &&
      amountCents === expected.amountCents &&
      isRtc === expected.isRtc &&
      sameText(value('notifyUrl', 'NotifyUrl'), expected.notifyUrl) &&
      sameText(banking.bankGroupId ?? banking.BankGroupId, expected.bankGroupId) &&
      sameText(banking.accountNumber ?? banking.AccountNumber, expected.encryptedAccountNumber) &&
      sameText(banking.branchCode ?? banking.BranchCode, expected.branchCode)
    );
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
      return webhookText(data[k]);
    };
    const amount = first('Amount');
    return {
      transactionId: first('TransactionId') ?? first('id'),
      merchantReference: first('TransactionReference') ?? first('merchantReference'),
      status: first('Status') ?? first('status') ?? 'Incomplete',
      amountCents: amount !== undefined ? this.decimalToCents(amount) : undefined,
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
    const ps = webhookRecord(body.payoutStatus ?? body.PayoutStatus);
    const status = webhookNumber(ps.status ?? body.status ?? body.Status) ?? 0;
    const subStatus = webhookNumber(ps.subStatus ?? body.subStatus ?? body.SubStatus) ?? 0;
    return {
      payoutId: webhookText(body.payoutId ?? body.PayoutId) ?? '',
      merchantReference:
        webhookText(body.merchantReference ?? body.MerchantReference) ?? '',
      status,
      subStatus,
      errorMessage: webhookText(ps.errorMessage ?? body.errorMessage ?? body.ErrorMessage) ?? '',
    };
  }

  /** Verify a payout notification hash (SHA-512, lowercased, apiKey-appended). */
  verifyPayoutNotificationHash(body: Record<string, unknown>): boolean {
    if (!this.payoutApiKey) return false;
    const ps = webhookRecord(body.payoutStatus ?? body.PayoutStatus);
    const status = webhookNumber(ps.status ?? body.status ?? body.Status);
    const subStatus = webhookNumber(ps.subStatus ?? body.subStatus ?? body.SubStatus);
    const payoutId = webhookText(body.payoutId ?? body.PayoutId);
    const merchantReference = webhookText(
      body.merchantReference ?? body.MerchantReference,
    );
    const customerMerchantReference = webhookText(
      body.customerMerchantReference ?? body.CustomerMerchantReference,
    );
    const provided = webhookText(body.hashCheck ?? body.HashCheck);
    if (
      status === undefined ||
      subStatus === undefined ||
      !payoutId ||
      !merchantReference ||
      customerMerchantReference === undefined ||
      !provided
    ) {
      return false;
    }
    const expected = buildPayoutNotificationHash({
      payoutId,
      siteCode: this.payoutSiteCode,
      merchantReference,
      customerMerchantReference,
      status,
      subStatus,
      apiKey: this.payoutApiKey,
    });
    return safeEqualHex(expected, provided);
  }

  /** Verify the pre-dispersal payout verification webhook hash. */
  verifyPayoutVerifyHash(body: Record<string, unknown>): boolean {
    if (!this.payoutApiKey) return false;
    const banking = webhookRecord(body.bankingDetails ?? body.BankingDetails);
    const amount = webhookNumber(body.amount ?? body.Amount);
    const rawRtc = body.isRtc ?? body.IsRtc;
    const payoutId = webhookText(body.payoutId ?? body.PayoutId);
    const merchantReference = webhookText(
      body.merchantReference ?? body.MerchantReference,
    );
    const customerBankReference = webhookText(
      body.customerBankReference ?? body.CustomerBankReference,
    );
    const notifyUrl = webhookText(body.notifyUrl ?? body.NotifyUrl);
    const bankGroupId = webhookText(
      banking.bankGroupId ?? banking.BankGroupId,
    );
    const encryptedAccountNumber = webhookText(
      banking.accountNumber ?? banking.AccountNumber,
    );
    const branchCode = webhookText(banking.branchCode ?? banking.BranchCode);
    const provided = webhookText(body.hashCheck ?? body.HashCheck);
    if (
      amount === undefined ||
      (typeof rawRtc !== 'boolean' && typeof rawRtc !== 'string') ||
      payoutId === undefined ||
      merchantReference === undefined ||
      customerBankReference === undefined ||
      notifyUrl === undefined ||
      bankGroupId === undefined ||
      encryptedAccountNumber === undefined ||
      branchCode === undefined ||
      !provided
    ) {
      return false;
    }
    const amountCents = Math.round(amount * 100);
    const isRtc = rawRtc === true || rawRtc === 'true';
    const expected = buildPayoutVerifyHash({
      payoutId,
      siteCode: this.payoutSiteCode,
      amountCents,
      merchantReference,
      customerBankReference,
      isRtc,
      notifyUrl,
      bankGroupId,
      encryptedAccountNumber,
      branchCode,
      apiKey: this.payoutApiKey,
    });
    return safeEqualHex(expected, provided);
  }

  isPayoutAccessTokenValid(token: string | undefined): boolean {
    return !!this.payoutAccessToken && token === this.payoutAccessToken;
  }

  /** Re-exported for the verification-webhook handler. */
  static normaliseBank(raw: string | null | undefined) {
    return normaliseOzowBank(raw);
  }
}
