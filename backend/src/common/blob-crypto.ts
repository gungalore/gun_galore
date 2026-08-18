import * as crypto from 'node:crypto';

// AES-256-GCM round-trip for ARBITRARY-LENGTH sensitive text.
//
// WHY THIS EXISTS SEPARATELY FROM id-crypto.ts. That module is deliberately
// narrow: encryptSaIdNumber() hard-rejects anything that isn't exactly 13
// digits, which is correct for its job (never accidentally encrypt garbage
// into the SA ID column) and useless for ours. The licence-motivation writer
// stores whole documents — the applicant's answers as JSON, the generated
// motivation body, the follow-up interview, and what Claude read off a scanned
// licence. All of it is POPIA-sensitive: ID numbers, home addresses, the
// security circumstances behind a self-defence application, firearm serials.
//
// SAME ENVELOPE, DIFFERENT DOMAIN. The stored format is byte-identical to
// id-crypto's — [12-byte IV][16-byte tag][ciphertext], base64 — so anyone who
// has read that file already knows this one. What differs is the HKDF `info`
// string. id-crypto.ts:35-38 explains the rule: a different info string means
// the two domains derive different keys from the same secret and therefore
// cannot accidentally interoperate. A ciphertext from one will not decrypt in
// the other; it fails the auth tag, loudly.
//
// KEY SOURCE is ID_HASH_SECRET, the same env var, on purpose — one secret to
// protect and rotate rather than two. Rotating it invalidates SA ID
// ciphertexts AND everything here, which is why nothing in this module has a
// hardcoded fallback: it throws when the secret is missing (id-crypto.ts:29-33
// posture) rather than silently encrypting under a default key that would make
// the data unrecoverable after the first real deploy.
//
// VERIFIED 2026-08-18: ID_HASH_SECRET is present on the live alloutdoor box.
// If that ever stops being true this module throws at runtime with no
// compile-time signal, so main.ts calls blobCryptoConfigured() in its boot
// gate and logs loudly. (That call was asserted here before it existed — the
// gate is real as of 2026-08-18.)

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Human-readable name for boot checks and error messages. */
export const BLOB_CRYPTO_SECRET_ENV = 'ID_HASH_SECRET';

function getKey(): Buffer {
  const secret = process.env[BLOB_CRYPTO_SECRET_ENV];
  if (!secret) {
    throw new Error(
      `${BLOB_CRYPTO_SECRET_ENV} is not configured — cannot encrypt/decrypt sensitive documents`,
    );
  }
  // Distinct `info` from id-crypto's 'gungalore-id-encrypt' — see the file
  // comment. Do NOT change this string once anything is stored: it is part of
  // the key derivation, so changing it makes every existing ciphertext
  // undecryptable.
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      secret,
      Buffer.alloc(0),
      'alloutdoor-doc-encrypt',
      32,
    ),
  );
}

/** True when the secret is present, for boot checks that must not throw. */
export function blobCryptoConfigured(): boolean {
  return !!process.env[BLOB_CRYPTO_SECRET_ENV];
}

/**
 * Encrypt arbitrary text for at-rest storage.
 *
 * Accepts any non-empty string — no format validation, deliberately, unlike
 * encryptSaIdNumber. Empty input throws rather than storing an encrypted empty
 * string, because a caller encrypting "" is always a bug upstream.
 */
export function encryptText(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Nothing to encrypt — refusing to store an empty blob');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt text written by encryptText.
 *
 * Throws when the ciphertext is malformed OR when the auth tag does not verify
 * — GCM gives us tamper detection for free and we surface it rather than
 * returning a partial plaintext.
 */
export function decryptText(encoded: string): string {
  if (!encoded) throw new Error('No ciphertext to decrypt');
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Ciphertext is too short to be valid');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Encrypt raw BYTES — scanned licences, ID documents, previous motivations.
 *
 * Same envelope as encryptText but binary in, binary out: there is no base64
 * round-trip, because these are megabyte-scale files written straight to disk
 * and base64 would inflate them by a third for no benefit.
 */
export function encryptBuffer(plain: Buffer): Buffer {
  if (!Buffer.isBuffer(plain) || plain.length === 0) {
    throw new Error('Nothing to encrypt — refusing to store an empty file');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/** Decrypt bytes written by encryptBuffer. Throws on tamper or truncation. */
export function decryptBuffer(encoded: Buffer): Buffer {
  if (!Buffer.isBuffer(encoded) || encoded.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Ciphertext is too short to be valid');
  }
  const iv = encoded.subarray(0, IV_LENGTH);
  const tag = encoded.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = encoded.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Encrypt a JSON-serialisable value. Convenience over encryptText so callers
 * don't each re-invent the stringify/parse pair (and so the parse failure mode
 * lives in exactly one place).
 */
export function encryptJson(value: unknown): string {
  return encryptText(JSON.stringify(value));
}

/**
 * Decrypt and parse a JSON blob written by encryptJson.
 *
 * A decrypt failure and a parse failure are different faults and we keep them
 * distinguishable: decryption throwing means wrong key or tampering, JSON.parse
 * throwing means we stored something malformed. Both throw, neither is
 * swallowed — a caller that wants a default should catch.
 */
export function decryptJson<T = unknown>(encoded: string): T {
  const raw = decryptText(encoded);
  return JSON.parse(raw) as T;
}

/**
 * Best-effort decrypt for READ paths that must not 500 on one bad row —
 * an admin queue listing 50 motivations, say, where one has a ciphertext
 * written under a rotated secret. Returns null instead of throwing.
 *
 * Never use this on a write path or anywhere the caller needs to KNOW the
 * value was recovered: a silent null is exactly the wrong answer when you are
 * about to render a document.
 */
export function tryDecryptText(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  try {
    return decryptText(encoded);
  } catch {
    return null;
  }
}
