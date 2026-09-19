import {
  computeSvixSignature,
  verifySvixSignature,
  buildPayoutRequestHash,
  buildPayoutVerifyHash,
  buildPayoutNotificationHash,
  encryptAccountNumber,
  safeEqualHex,
} from './ozow-signature';

// The published Svix golden vector from hub.ozow.com (verify-a-webhook).
const GOLDEN = {
  secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
  body: '{"event_type":"ping","data":{"success":true}}',
  id: 'msg_loFOjxBNrRLzqYUf',
  timestamp: '1731705121',
  signature: 'rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
};

describe('Svix webhook signature', () => {
  it('reproduces the published golden vector digest', () => {
    expect(
      computeSvixSignature(GOLDEN.secret, GOLDEN.id, GOLDEN.timestamp, GOLDEN.body),
    ).toBe(GOLDEN.signature);
  });

  it('accepts a current, correctly-signed delivery and rejects a tampered body', () => {
    const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
    const now = Math.floor(Date.now() / 1000).toString();
    const body = '{"type":"transaction.complete","data":{"status":"Successful"}}';
    const sig = computeSvixSignature(secret, 'msg_1', now, body);
    expect(
      verifySvixSignature(secret, { id: 'msg_1', timestamp: now, signature: `v1,${sig}` }, body),
    ).toBe(true);
    expect(
      verifySvixSignature(
        secret,
        { id: 'msg_1', timestamp: now, signature: `v1,${sig}` },
        body.replace('Successful', 'Error'),
      ),
    ).toBe(false);
  });

  it('rejects a delivery outside the 5-minute replay window', () => {
    const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
    const stale = '1731705121'; // 2024
    const sig = computeSvixSignature(secret, GOLDEN.id, stale, GOLDEN.body);
    expect(
      verifySvixSignature(secret, { id: GOLDEN.id, timestamp: stale, signature: `v1,${sig}` }, GOLDEN.body),
    ).toBe(false);
  });
});

describe('Payouts API hashes (SHA-512, lowercased)', () => {
  const apiKey = 'TestApiKey12345';

  it('builds a request hash deterministically from the documented field order', () => {
    const a = buildPayoutRequestHash({
      siteCode: 'TESTSITE01',
      amountCents: 10000,
      merchantReference: 'AO123',
      customerBankReference: 'AO 123',
      isRtc: false,
      notifyUrl: 'https://x/y',
      bankGroupId: 'gid',
      encryptedAccountNumber: 'abc=',
      branchCode: '250655',
      apiKey,
    });
    expect(a).toMatch(/^[0-9a-f]{128}$/);
    // Lowercasing: an uppercase site code hashes the same as lowercase.
    const b = buildPayoutRequestHash({
      siteCode: 'testsite01',
      amountCents: 10000,
      merchantReference: 'AO123',
      customerBankReference: 'AO 123',
      isRtc: false,
      notifyUrl: 'https://x/y',
      bankGroupId: 'gid',
      encryptedAccountNumber: 'abc=',
      branchCode: '250655',
      apiKey,
    });
    expect(a).toBe(b);
  });

  it('changes when the amount changes (rounds to cents)', () => {
    const base = { siteCode: 'S', amountCents: 10000, merchantReference: 'R', customerBankReference: 'C', isRtc: false, notifyUrl: 'https://x', bankGroupId: 'g', encryptedAccountNumber: 'a', branchCode: '1', apiKey };
    expect(buildPayoutRequestHash(base)).not.toBe(
      buildPayoutRequestHash({ ...base, amountCents: 10001 }),
    );
  });

  it('builds the notification hash from integer status/subStatus', () => {
    const h = buildPayoutNotificationHash({
      payoutId: 'p',
      siteCode: 'S',
      merchantReference: 'R',
      customerMerchantReference: 'C',
      status: 5,
      subStatus: 0,
      apiKey,
    });
    expect(h).toMatch(/^[0-9a-f]{128}$/);
  });

  it('builds the verification-webhook hash', () => {
    const h = buildPayoutVerifyHash({
      payoutId: 'p',
      siteCode: 'S',
      amountCents: 10000,
      merchantReference: 'R',
      customerBankReference: 'C',
      isRtc: false,
      notifyUrl: 'https://x',
      bankGroupId: 'g',
      encryptedAccountNumber: 'a',
      branchCode: '1',
      apiKey,
    });
    expect(h).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe('safeEqualHex', () => {
  it('compares in constant time shape', () => {
    expect(safeEqualHex('abc', 'abc')).toBe(true);
    expect(safeEqualHex('abc', 'abd')).toBe(false);
    expect(safeEqualHex('abc', 'abcd')).toBe(false);
  });
});

describe('encryptAccountNumber (AES-256-CBC)', () => {
  it('produces Base64 ciphertext, deterministic per reference+amount', () => {
    const a = encryptAccountNumber('123456789', 'KEY', 'AO123', 10000);
    const b = encryptAccountNumber('123456789', 'KEY', 'AO123', 10000);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(a).toBe(b);
  });

  it('changes with the amount (IV is amount-derived)', () => {
    const a = encryptAccountNumber('123456789', 'KEY', 'AO123', 10000);
    const b = encryptAccountNumber('123456789', 'KEY', 'AO123', 10001);
    expect(a).not.toBe(b);
  });
});
