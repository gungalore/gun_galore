import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (and the RFC 4226 HOTP underneath it) in node:crypto.
 *
 * ⚠️ NO npm DEPENDENCY, ON PURPOSE. This is the second factor on the only
 * account that can approve a command that runs as root on the production box.
 * Every popular TOTP package is ~60 lines of the same HMAC wrapped in a
 * transitive dependency tree we would then be trusting with that. The whole
 * algorithm is below and is pinned to the published test vectors in
 * totp.spec.ts, so a change to it fails a test rather than a login.
 *
 * ⚠️ SHA-1 IS NOT A MISTAKE HERE AND MUST NOT BE "UPGRADED". RFC 6238 allows
 * SHA-256/512, but Google Authenticator, Authy, 1Password and every other
 * scanner of an `otpauth://` URI ignore the `algorithm=` parameter and assume
 * SHA-1. Switching this to SHA-256 produces codes that are correct by the RFC
 * and rejected by every phone the operator owns — a lockout that looks like a
 * wrong password. The construction's security does not rest on SHA-1
 * collision resistance; it is an HMAC over a counter with a 30-second life.
 */

/** Seconds per code. 30 is what every authenticator app assumes. */
export const TOTP_STEP_SECONDS = 30;

/** Digits in a code. 6 is what every authenticator app displays. */
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of "now" are accepted.
 *
 * ⚠️ 1 means a code is good for up to 90 seconds (previous step, current
 * step, next step) — that is the clock-drift allowance on the operator's
 * phone, not generosity. Widening it to 2 doubles the window an intercepted
 * code stays usable for; narrowing it to 0 means a phone thirty-one seconds
 * fast can never sign in and the failure looks exactly like a wrong code.
 */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * RFC 4648 base32, no padding on the way out.
 *
 * Authenticator apps read the secret out of the `otpauth://` URI as base32
 * and nothing else — hex or base64url in that slot is silently accepted by
 * the QR scanner and then produces codes that never match.
 */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * RFC 4648 base32 decode.
 *
 * Spaces and '=' are stripped and the input is upper-cased, because a human
 * re-typing a secret off a screen types it in groups of four in whatever case
 * their keyboard was in. Anything still unrecognised throws — a silently
 * skipped character decodes to a DIFFERENT secret, which enrols fine and then
 * never verifies.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Not a base32 character: ${JSON.stringify(ch)}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A fresh 160-bit secret, base32 encoded.
 *
 * 20 bytes because that is HMAC-SHA1's block-independent natural key length
 * and what the RFC 6238 reference implementation uses; shorter secrets are
 * accepted by apps and weaken the only thing standing between a stolen admin
 * password and a production shell.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP. `counter` is the moving factor. */
export function hotp(
  secret: Buffer,
  counter: number,
  digits: number = TOTP_DIGITS,
): string {
  // 8-byte big-endian counter. BigInt rather than writeUInt32BE pairs because
  // the time-step counter passes 2^32 in the year 6053 and a wrong high word
  // is not the kind of bug anyone would find.
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(buf).digest();

  // Dynamic truncation, RFC 4226 §5.3. The low nibble of the last byte picks
  // the offset; the high bit of the selected word is masked off so the result
  // is the same on every platform's signed/unsigned interpretation.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** RFC 6238 TOTP at a given wall-clock instant. */
export function totp(
  secret: Buffer,
  atMs: number = Date.now(),
  step: number = TOTP_STEP_SECONDS,
  digits: number = TOTP_DIGITS,
): string {
  return hotp(secret, Math.floor(atMs / 1000 / step), digits);
}

/**
 * Check a code a human just typed against a stored base32 secret.
 *
 * ⚠️ CONSTANT-TIME COMPARE. A plain `===` on a six-digit string leaks, over
 * enough attempts, how many leading digits were right — which turns a
 * 1-in-a-million guess into six 1-in-10 guesses. The lockout counter makes
 * that attack slow; it does not make it wrong to compare properly.
 *
 * Returns false rather than throwing on a malformed secret or code: the
 * caller's job is "let them in or don't", and a thrown 500 on a typed code
 * would tell an attacker they had found an interesting input.
 */
export function verifyTotpCode(
  base32Secret: string,
  code: string,
  opts: { now?: number; window?: number } = {},
): boolean {
  const now = opts.now ?? Date.now();
  const window = opts.window ?? TOTP_WINDOW;

  const typed = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(base32Secret);
  } catch {
    return false;
  }
  if (secret.length === 0) return false;

  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  let ok = false;
  for (let drift = -window; drift <= window; drift++) {
    const expected = hotp(secret, counter + drift);
    // Do not short-circuit the loop: returning early on the first match makes
    // the response time say WHICH step matched, which is a (small) clock
    // oracle. The loop is three HMACs; running all of them costs nothing.
    if (
      timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(typed, 'utf8'))
    ) {
      ok = true;
    }
  }
  return ok;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * ⚠️ THE LABEL AND THE `issuer=` PARAMETER MUST AGREE. Apps show the label;
 * some of them also de-duplicate on issuer. A mismatch produces two entries
 * for one account, and the operator picks the wrong one under pressure.
 *
 * The secret is in this string, so it is returned exactly once — at enrol —
 * and never logged, never stored beside the row, never put in a URL we fetch.
 */
export function otpauthUri(opts: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = opts.issuer ?? 'All Outdoor Desk';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
