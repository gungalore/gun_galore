import {
  encryptText,
  decryptText,
  encryptJson,
  decryptJson,
  tryDecryptText,
  blobCryptoConfigured,
} from './blob-crypto';
import { encryptSaIdNumber } from './id-crypto';

// The motivation writer stores whole documents under this module, so the two
// properties that matter are: it round-trips long text unchanged, and it
// REFUSES tampered or foreign ciphertext rather than returning something
// plausible-looking.

describe('blob-crypto', () => {
  const ORIGINAL = process.env.ID_HASH_SECRET;

  beforeEach(() => {
    process.env.ID_HASH_SECRET = 'test-secret-for-blob-crypto-specs';
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ID_HASH_SECRET;
    else process.env.ID_HASH_SECRET = ORIGINAL;
  });

  it('round-trips a short string', () => {
    const plain = 'Motivation for a dedicated hunter application.';
    expect(decryptText(encryptText(plain))).toBe(plain);
  });

  it('round-trips a 20 KB document unchanged', () => {
    // A real motivation runs several pages; id-crypto could never carry this
    // (it hard-rejects anything that is not 13 digits), which is why this
    // module exists.
    const plain = 'Ek het die plaas besoek. '.repeat(1000);
    expect(plain.length).toBeGreaterThan(20_000);
    expect(decryptText(encryptText(plain))).toBe(plain);
  });

  it('preserves newlines, unicode and Afrikaans diacritics', () => {
    // sanitizePromptValue collapses newlines and caps at 120 chars — storage
    // must not do the same or the applicant's own prose is destroyed.
    const plain = 'Eerste paragraaf.\n\nTweede: kalibers, “aanhalings”, 45° — dié een.';
    expect(decryptText(encryptText(plain))).toBe(plain);
  });

  it('produces a different ciphertext every time (random IV)', () => {
    const plain = 'same input';
    expect(encryptText(plain)).not.toBe(encryptText(plain));
  });

  it('round-trips JSON', () => {
    const value = {
      idNumber: '8001015009087',
      address: { street: '12 Kudu Ave', city: 'Bloemfontein' },
      calibres: ['.308', '.223'],
      nested: { deep: { flag: true, count: 3 } },
    };
    expect(decryptJson(encryptJson(value))).toEqual(value);
  });

  it('throws on an empty encrypt — that is always an upstream bug', () => {
    expect(() => encryptText('')).toThrow(/Nothing to encrypt/i);
  });

  it('throws when the auth tag does not verify (tamper detection)', () => {
    const encoded = encryptText('the applicant keeps the safe in the bedroom');
    const buf = Buffer.from(encoded, 'base64');
    // Flip a bit in the ciphertext body, past the IV and tag.
    buf[buf.length - 1] ^= 0x01;
    expect(() => decryptText(buf.toString('base64'))).toThrow();
  });

  it('throws on a truncated ciphertext', () => {
    expect(() => decryptText('AAAA')).toThrow(/too short/i);
  });

  it('throws when the secret is missing rather than using a default key', () => {
    delete process.env.ID_HASH_SECRET;
    expect(blobCryptoConfigured()).toBe(false);
    expect(() => encryptText('x')).toThrow(/ID_HASH_SECRET/);
  });

  it('CANNOT decrypt an id-crypto ciphertext — the HKDF info strings differ', () => {
    // This is the whole point of the separate `info` string (id-crypto.ts:35-38).
    // If this test ever passes-through, the two domains have been allowed to
    // interoperate and the separation is gone.
    const idCipher = encryptSaIdNumber('8001015009087');
    expect(() => decryptText(idCipher)).toThrow();
  });

  it('tryDecryptText returns null instead of throwing on a bad row', () => {
    expect(tryDecryptText(null)).toBeNull();
    expect(tryDecryptText(undefined)).toBeNull();
    expect(tryDecryptText('not-real-ciphertext')).toBeNull();
    expect(tryDecryptText(encryptText('fine'))).toBe('fine');
  });
});
