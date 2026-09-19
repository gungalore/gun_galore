import { createHash, createHmac, createCipheriv, timingSafeEqual } from 'crypto';

// ─── Ozow payments cryptography + verification (pure) ──────────────────
//
// Ozow runs two distinct rails, each with its own signing:
//   1. ONE API (pay-in / refunds)  — OAuth bearer + Svix-signed webhooks.
//   2. PAYOUTS API (disbursements) — ApiKey header + SHA-512 hashCheck on
//      the request, the verification webhook and the notification, and an
//      AES-256-CBC encrypted destination account number.
//
// Everything here is dependency-free and unit-testable so the exact
// algorithms are pinned against Ozow's documented examples (see the specs).

// ─── Svix webhook verification (One API) ──────────────────────────────

const SVIX_TOLERANCE_SECONDS = 300;

export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/** Compute the Base64 Svix HMAC digest for a delivery (exported so the
 *  golden vector can be pinned in tests independent of the replay window). */
export function computeSvixSignature(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest('base64');
}

/**
 * Verify a One API webhook delivery. Ozow signs `${svix-id}.${svix-timestamp}
 * .${rawBody}` with HMAC-SHA256, keyed by the raw bytes of the `whsec_` secret,
 * and sends the Base64 digest in `svix-signature` as one or more
 * `v1,<base64>` entries (space separated — more than one during a rotation).
 *
 * Five checks are all load-bearing: all three headers present, a ±5-minute
 * replay window, the secret decoded (not used as a string), the raw body
 * (never a re-serialised object), and a constant-time compare against every
 * `v1` signature.
 */
export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const sent = Number(timestamp);
  if (!Number.isInteger(sent)) return false;
  const sentMs = sent > 1e12 ? sent : sent * 1000;
  if (Math.abs(Date.now() - sentMs) > SVIX_TOLERANCE_SECONDS * 1000) return false;

  const expected = computeSvixSignature(secret, id, timestamp, rawBody);

  return signature.split(' ').some((candidate) => {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    return (
      given.length === want.length && timingSafeEqual(given, want)
    );
  });
}

/** Constant-time hex comparison (hash checks are compared, not echoed). */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ─── SHA-512 hashCheck helpers (Payouts API) ───────────────────────────
//
// Ozow signs payout requests, verification callbacks and notifications by
// concatenating fields IN ORDER (empty fields excluded), appending the API
// key, lowercasing the whole string, then taking a SHA-512 hex digest.

function sha512LowerHex(parts: (string | number | boolean | undefined | null)[]): string {
  const joined = parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p) => String(p))
    .join('')
    .toLowerCase();
  return createHash('sha512').update(joined, 'utf8').digest('hex');
}

/**
 * Request hash for POST /requestpayout. Order:
 * siteCode, amountCents, merchantReference, customerBankReference, isRtc,
 * notifyUrl, bankGroupId, encryptedAccountNumber, branchCode, apiKey.
 */
export function buildPayoutRequestHash(params: {
  siteCode: string;
  amountCents: number;
  merchantReference: string;
  customerBankReference: string;
  isRtc: boolean;
  notifyUrl?: string;
  bankGroupId: string;
  encryptedAccountNumber: string;
  branchCode: string;
  apiKey: string;
}): string {
  return sha512LowerHex([
    params.siteCode,
    Math.round(params.amountCents),
    params.merchantReference,
    params.customerBankReference,
    params.isRtc ? 'true' : 'false',
    params.notifyUrl,
    params.bankGroupId,
    params.encryptedAccountNumber,
    params.branchCode,
    params.apiKey,
  ]);
}

/**
 * Verification-webhook hash (Ozow → us). Order:
 * payoutId, siteCode, amountCents, merchantReference, customerBankReference,
 * isRtc, notifyUrl, bankGroupId, encryptedAccountNumber, branchCode, apiKey.
 */
export function buildPayoutVerifyHash(params: {
  payoutId: string;
  siteCode: string;
  amountCents: number;
  merchantReference: string;
  customerBankReference: string;
  isRtc: boolean;
  notifyUrl?: string;
  bankGroupId: string;
  encryptedAccountNumber: string;
  branchCode: string;
  apiKey: string;
}): string {
  return sha512LowerHex([
    params.payoutId,
    params.siteCode,
    Math.round(params.amountCents),
    params.merchantReference,
    params.customerBankReference,
    params.isRtc ? 'true' : 'false',
    params.notifyUrl,
    params.bankGroupId,
    params.encryptedAccountNumber,
    params.branchCode,
    params.apiKey,
  ]);
}

/**
 * Notification hash (Ozow → us). Order:
 * payoutId, siteCode, merchantReference, customerMerchantReference,
 * payoutStatus (integer), payoutSubStatus (integer), apiKey.
 */
export function buildPayoutNotificationHash(params: {
  payoutId: string;
  siteCode: string;
  merchantReference: string;
  customerMerchantReference: string;
  status: number;
  subStatus: number;
  apiKey: string;
}): string {
  return sha512LowerHex([
    params.payoutId,
    params.siteCode,
    params.merchantReference,
    params.customerMerchantReference,
    Math.round(params.status),
    Math.round(params.subStatus),
    params.apiKey,
  ]);
}

// ─── AES-256-CBC account-number encryption (Payouts API) ───────────────
//
// Ozow requires the destination account number encrypted before it leaves
// our system. IV = first 16 chars of SHA-512(merchantReference + amountCents
// + encryptionKey).toLowerCase() hex, used as UTF-8 bytes. Key = the
// encryption key repeated/truncated to 32 bytes. PKCS7 padding via Node's
// default auto-padding, Base64 output.

export function encryptAccountNumber(
  accountNumber: string,
  encryptionKey: string,
  merchantReference: string,
  amountCents: number,
): string {
  const ivString = (
    merchantReference +
    Math.round(amountCents) +
    encryptionKey
  ).toLowerCase();
  const iv = createHash('sha512').update(ivString, 'utf8').digest('hex').substring(0, 16);

  let key = encryptionKey;
  while (key.length < 32) key += encryptionKey;
  key = key.substring(0, 32);

  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(accountNumber, 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}
