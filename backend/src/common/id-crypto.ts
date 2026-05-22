import * as crypto from 'node:crypto';

// AES-256-GCM round-trip for SA ID numbers stored on User.
// idNumberEncrypted. We collect the raw 13-digit ID when the seller
// fills in the post-first-publish profile modal so we can pass it to
// VerifyNow at KYC time (so the seller doesn't have to type it twice).
//
// POPIA shape:
//   - We DO NOT keep the raw ID in plaintext anywhere.
//   - At rest the value is AES-256-GCM ciphertext + IV + auth-tag,
//     base64-encoded. The key derives from ID_HASH_SECRET (already
//     in .env) via HKDF.
//   - After the VerifyNow lookup passes for that seller we PURGE this
//     column (set null) and keep only kycIdHash long-term — the raw
//     ID is transient PII we don't need once the seller is verified.
//   - The same secret is used both for hashing (legacy kycIdHash) and
//     for this key derivation. Rotating the secret invalidates both
//     — see the comment in .env about rotation.
//
// Stored format (a single base64 string):
//   [12 bytes IV] + [16 bytes auth tag] + [N bytes ciphertext]

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.ID_HASH_SECRET;
  if (!secret) {
    throw new Error(
      'ID_HASH_SECRET is not configured — cannot encrypt/decrypt SA ID numbers',
    );
  }
  // HKDF-SHA256: deterministic 32-byte key derivation from the secret.
  // Different "info" string from the hash usage so the two domains
  // can't accidentally interop.
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'gungalore-id-encrypt', 32),
  );
}

/**
 * Encrypt a raw SA ID number for at-rest storage.
 * Input must be exactly 13 digits (SA ID format); throws otherwise so
 * we never accidentally encrypt garbage.
 */
export function encryptSaIdNumber(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!/^\d{13}$/.test(trimmed)) {
    throw new Error('SA ID number must be exactly 13 digits');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ct = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt a previously encrypted SA ID. Returns the plaintext on
 * success; throws if the ciphertext is malformed or the auth tag
 * doesn't verify (tamper detection).
 */
export function decryptSaIdNumber(encoded: string): string {
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
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * SHA-256 hash of the SA ID (with ID_HASH_SECRET as salt). Same
 * function shape as kyc.service.ts uses today — exposed here so
 * the profile-complete flow can write both the encrypted blob AND
 * the long-term hash in one place.
 */
export function hashSaIdNumber(raw: string): string {
  const secret = process.env.ID_HASH_SECRET;
  if (!secret) throw new Error('ID_HASH_SECRET is not configured');
  return crypto
    .createHash('sha256')
    .update(secret + raw.trim())
    .digest('hex');
}
