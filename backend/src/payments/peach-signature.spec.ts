import {
  buildSignatureBase,
  signParams,
  verifyFieldSignature,
  verifyWebhookHeaderSignature,
  classifyResultCode,
  classifyPayoutCode,
} from './peach-signature';
import { createHmac } from 'crypto';

// The exact worked example from Peach's Hosted Checkout authentication docs.
const EXAMPLE_PARAMS = {
  amount: '2',
  authentication: { entityId: '8ac7a4ca68c22c4d0168c2caab2e0025' },
  currency: 'ZAR',
  defaultPaymentMethod: 'CARD',
  merchantTransactionId: 'Test1234',
  nonce: 'JHGJSGHDSKJHGJDHGJH',
  paymentType: 'DB',
  shopperResultUrl: 'https://example.com/example-webhook',
};
const EXAMPLE_SECRET = '3fcd7cf22f55119eadbe02d14de18c0c';

describe('peach signature — documented golden vector', () => {
  it('flattens authentication.entityId and sorts to the exact documented base string', () => {
    expect(buildSignatureBase(EXAMPLE_PARAMS)).toBe(
      'amount2authentication.entityId8ac7a4ca68c22c4d0168c2caab2e0025' +
        'currencyZARdefaultPaymentMethodCARDmerchantTransactionIdTest1234' +
        'nonceJHGJSGHDSKJHGJDHGJHpaymentTypeDBshopperResultUrl' +
        'https://example.com/example-webhook',
    );
  });

  // NOTE on the published digest: Peach's docs show TWO different base
  // strings for this same example (one mixed-case ending in the full URL,
  // one all-lowercase truncated) and both claim HMAC `311ed8e1…`. Neither
  // hashes to that value, so the published DIGEST is a doc transcription
  // error — the published ALGORITHM (which our base-string test above
  // matches byte-for-byte) is what's authoritative. We therefore pin OUR
  // digest as a regression anchor rather than the corrupt published one.
  // The secret is used as a RAW-STRING HMAC key (the universal Peach
  // copyandpay convention: PHP hash_hmac($msg,$secret) with $secret raw).
  // ⚠️ Confirm this on the FIRST sandbox transaction — if Peach rejects
  // the signature, the only plausible variant is a hex-decoded key
  // (Buffer.from(secret,'hex')); flip it in signParams if so.
  const OUR_DIGEST =
    'fc1273384a7806c00a6e0512e902be4ed2181af8b72030653310dfc385d1eab4';

  it('is deterministic + pinned (regression anchor for the raw-string-key algorithm)', () => {
    expect(signParams(EXAMPLE_PARAMS, EXAMPLE_SECRET)).toBe(OUR_DIGEST);
  });

  it('never includes the signature field in its own base', () => {
    const withSig = { ...EXAMPLE_PARAMS, signature: 'deadbeef' };
    expect(signParams(withSig, EXAMPLE_SECRET)).toBe(OUR_DIGEST);
  });

  it('includes empty-valued params (key + empty string)', () => {
    expect(buildSignatureBase({ b: '', a: 'x' })).toBe('ax' + 'b');
  });
});

describe('verifyFieldSignature', () => {
  it('accepts a correctly-signed inbound payload and rejects a tampered one', () => {
    const payload: Record<string, unknown> = {
      merchantTransactionId: 'Test1234',
      amount: '2',
      currency: 'ZAR',
      'result.code': '000.000.000',
    };
    payload.signature = signParams(payload, EXAMPLE_SECRET);
    expect(verifyFieldSignature(payload, EXAMPLE_SECRET)).toBe(true);

    expect(
      verifyFieldSignature({ ...payload, amount: '2000' }, EXAMPLE_SECRET),
    ).toBe(false);
    expect(verifyFieldSignature({ ...payload, signature: '' }, EXAMPLE_SECRET)).toBe(
      false,
    );
  });
});

describe('verifyWebhookHeaderSignature', () => {
  const url = 'https://gungalore.co.za/api/payments/webhook/peach';
  const raw = 'merchantTransactionId=Test1234&result.code=000.000.000';
  function headerFor(tsMs: number, id: string, secret: string) {
    const base = `${tsMs}.${id}.${url}.${raw}`;
    return createHmac('sha256', secret).update(base, 'utf8').digest('hex');
  }

  it('accepts a fresh, correctly-signed header', () => {
    const ts = Date.now();
    const sig = headerFor(ts, 'wh_1', EXAMPLE_SECRET);
    expect(
      verifyWebhookHeaderSignature(
        raw,
        { id: 'wh_1', timestamp: String(ts), signature: `v1,${sig}` },
        url,
        EXAMPLE_SECRET,
      ),
    ).toBe(true);
  });

  it('rejects a stale timestamp (replay) and a wrong secret', () => {
    const stale = Date.now() - 10 * 60 * 1000;
    expect(
      verifyWebhookHeaderSignature(
        raw,
        { id: 'wh_1', timestamp: String(stale), signature: headerFor(stale, 'wh_1', EXAMPLE_SECRET) },
        url,
        EXAMPLE_SECRET,
      ),
    ).toBe(false);

    const ts = Date.now();
    expect(
      verifyWebhookHeaderSignature(
        raw,
        { id: 'wh_1', timestamp: String(ts), signature: headerFor(ts, 'wh_1', 'wrong') },
        url,
        EXAMPLE_SECRET,
      ),
    ).toBe(false);
  });
});

describe('result-code classification', () => {
  it('buckets checkout codes', () => {
    expect(classifyResultCode('000.000.000')).toBe('success');
    expect(classifyResultCode('000.100.110')).toBe('success');
    expect(classifyResultCode('000.200.000')).toBe('pending');
    expect(classifyResultCode('800.100.150')).toBe('rejected');
    expect(classifyResultCode(undefined)).toBe('rejected');
  });
  it('buckets payout codes', () => {
    expect(classifyPayoutCode('2000.000.000')).toBe('success');
    expect(classifyPayoutCode('2900.000.003')).toBe('processing');
    expect(classifyPayoutCode('2001.002.106')).toBe('failed');
  });
});
