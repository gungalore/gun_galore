import { createHmac, timingSafeEqual } from 'crypto';

// ─── Meta WhatsApp Cloud API webhook signature verification (pure) ────────
//
// Meta signs every webhook POST body with HMAC-SHA256, keyed by the App
// Secret, and sends the hex digest in `X-Hub-Signature-256` prefixed with
// `sha256=`. Verify over the RAW request bytes — `main.ts` already creates
// the Nest app with `{ rawBody: true }` (see `main.ts:149`), so
// `req.rawBody` is exactly what Meta signed; re-serialising the parsed body
// can reorder keys and never match.
//
// Same shape as `backend/src/payments/peach-signature.ts`: a pure,
// dependency-free, separately unit-tested function so the algorithm is
// pinned independent of any framework or Nest DI.
export function verifyMetaSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch rather than returning false —
  // guard it explicitly so a tampered/short signature fails closed instead
  // of throwing out of the webhook handler.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
