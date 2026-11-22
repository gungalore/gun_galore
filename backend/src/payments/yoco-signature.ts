import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Yoco Checkout API webhook signatures.
 *
 * The signed content is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC'd
 * with SHA-256 and base64-encoded. The secret arrives as `whsec_<base64>` and
 * the prefix is stripped and the remainder base64-decoded before it is used as
 * the key — exactly as Yoco's own guide does it. The `webhook-signature` header
 * is a space-separated list of `version,base64` entries; any matching entry is
 * a valid delivery.
 *
 * The timestamp is part of the signed content and MUST be checked against the
 * clock (Yoco recommends three minutes): otherwise a captured delivery can be
 * replayed forever and every replay is a payment we might apply twice.
 *
 * Kept free of Nest/Prisma/fetch so the parsing and the comparison can be
 * tested directly, the same way the Ozow and Peach signers are.
 */

export type YocoSignatureVerdict = 'valid' | 'invalid' | 'unsigned';

export interface YocoSignatureHeaders {
  id?: string | string[];
  timestamp?: string | string[];
  signature?: string | string[];
}

export interface YocoSignatureInput {
  rawBody: string;
  headers: YocoSignatureHeaders;
  /** `whsec_...` from the Yoco dashboard. Missing ⇒ 'unsigned'. */
  secret?: string | undefined;
  /** Unix seconds. Injected by tests; defaults to the real clock. */
  nowSeconds?: number;
  /** How far apart the signature timestamp and the clock may be. */
  toleranceSeconds?: number;
}

export const YOCO_SIGNATURE_TOLERANCE_SECONDS = 180;

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** `whsec_<base64>` → the bytes Yoco used as the HMAC key. */
export function decodeYocoSecret(secret: string): Buffer | null {
  const raw = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  if (!raw) return null;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length > 0 ? bytes : null;
}

export function verifyYocoWebhook(
  input: YocoSignatureInput,
): YocoSignatureVerdict {
  if (!input.secret) return 'unsigned';

  const id = headerValue(input.headers.id);
  const timestamp = headerValue(input.headers.timestamp);
  const signature = headerValue(input.headers.signature);
  if (!id || !timestamp || !signature) return 'invalid';

  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) return 'invalid';
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance =
    input.toleranceSeconds ?? YOCO_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - sentAt) > tolerance) return 'invalid';

  const key = decodeYocoSecret(input.secret);
  if (!key) return 'invalid';

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest();

  // `v1,<sig> v1,<sig>` — compare every entry, in constant time.
  let matched = false;
  for (const entry of signature.split(' ')) {
    if (!entry) continue;
    const comma = entry.indexOf(',');
    if (comma < 0) continue;
    const candidate = Buffer.from(entry.slice(comma + 1), 'base64');
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      matched = true;
    }
  }
  return matched ? 'valid' : 'invalid';
}
