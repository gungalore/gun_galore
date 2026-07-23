import { createHmac, timingSafeEqual } from 'crypto';

// ─── Peach Payments signing + result-code classification (pure) ───────
//
// Kept dependency-free + separately unit-tested so the exact algorithm is
// pinned against Peach's own documented worked example (see the spec).
//
// SIGNATURE (Checkout create, Refund, and verifying the shopperResultUrl
// POST / classic transaction webhooks):
//   1. Flatten every request parameter to dotted keys (authentication.entityId).
//   2. Include ALL parameters, even empty-valued ones.
//   3. Sort by key, ascending (byte/UTF-16 order — matches Peach's example).
//   4. Concatenate key immediately followed by value, no separators.
//   5. HMAC-SHA256 the string, keyed by the secret token; hex output.
// Peach signs its responses to us with the SAME method, so we verify an
// inbound `signature` field by recomputing over the other fields.

/** Flatten a nested object to dotted-key/string-value pairs. */
export function flattenParams(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'signature') continue; // never sign the signature itself
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out[key] = '';
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenParams(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/** Build the signed string per the Peach algorithm. Exported for tests. */
export function buildSignatureBase(params: Record<string, unknown>): string {
  const flat = flattenParams(params);
  return Object.keys(flat)
    .sort()
    .map((k) => `${k}${flat[k]}`)
    .join('');
}

/** HMAC-SHA256 hex signature over the params, keyed by the secret token. */
export function signParams(
  params: Record<string, unknown>,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(buildSignatureBase(params), 'utf8')
    .digest('hex');
}

/**
 * Verify an inbound payload's `signature` field (shopperResultUrl POST and
 * classic transaction webhooks). Constant-time compare. `payload` is the
 * already-parsed body (its own `signature` key is excluded from the base).
 */
export function verifyFieldSignature(
  payload: Record<string, unknown>,
  secret: string,
): boolean {
  const provided = String(payload.signature ?? '');
  if (!provided) return false;
  const expected = signParams(payload, secret);
  return safeEqualHex(provided, expected);
}

/**
 * Verify the newer webhook system's header signature. Peach signs
 * `${timestamp}.${webhookId}.${url}.${rawBody}` with HMAC-SHA256 and sends
 * the hex digest in `x-webhook-signature`. `url` is this endpoint's public
 * URL exactly as registered. Uses the RAW body bytes as received.
 */
export function verifyWebhookHeaderSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  url: string,
  secret: string,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  // 5-minute replay tolerance (timestamp may be seconds or millis).
  const tsMs = tsSec > 1e12 ? tsSec : tsSec * 1000;
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) return false;
  const base = `${timestamp}.${id}.${url}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(base, 'utf8').digest('hex');
  // The header may be bare hex or a "v1,<hex>" list — accept any match.
  return signature
    .split(/[ ,]+/)
    .filter((s) => s && s !== 'v1')
    .some((sig) => safeEqualHex(sig, expected));
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ─── Result-code classification (OPPWA / Peach standard) ──────────────
// https://peachpayments.docs — the connector result codes are the OPP
// standard set. We only need three buckets.

const SUCCESS = /^(000\.000\.|000\.100\.1|000\.[36]0)/;
const SUCCESS_MANUAL_REVIEW = /^(000\.400\.0[^3]|000\.400\.100)/;
const PENDING = /^(000\.200|800\.400\.5|100\.400\.500)/;

export type PeachResultBucket = 'success' | 'pending' | 'rejected';

export function classifyResultCode(code: string | undefined): PeachResultBucket {
  if (!code) return 'rejected';
  if (SUCCESS.test(code) || SUCCESS_MANUAL_REVIEW.test(code)) return 'success';
  if (PENDING.test(code)) return 'pending';
  return 'rejected';
}

// Payouts API uses a different, dotted-numeric code space.
//   2000.000.000 success · 2900.000.003 processing · 2001.* failed
export function classifyPayoutCode(
  code: string | undefined,
): 'success' | 'processing' | 'failed' {
  if (!code) return 'failed';
  if (code.startsWith('2000.')) return 'success';
  if (code.startsWith('2900.')) return 'processing';
  return 'failed';
}
