import { createHmac } from 'crypto';
import {
  decodeYocoSecret,
  verifyYocoWebhook,
  YOCO_SIGNATURE_TOLERANCE_SECONDS,
} from './yoco-signature';

const KEY_BYTES = Buffer.from('a-test-signing-key');
const SECRET = `whsec_${KEY_BYTES.toString('base64')}`;
const NOW = 1_800_000_000;

function sign(
  id: string,
  timestamp: string,
  body: string,
  keyBytes: Buffer = KEY_BYTES,
): string {
  const digest = createHmac('sha256', keyBytes)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${digest}`;
}

describe('Yoco webhook signatures', () => {
  it('decodes the whsec_ secret into the HMAC key', () => {
    expect(decodeYocoSecret(SECRET)).toEqual(KEY_BYTES);
    // A raw base64 secret without the prefix is tolerated.
    expect(decodeYocoSecret(KEY_BYTES.toString('base64'))).toEqual(KEY_BYTES);
    expect(decodeYocoSecret('whsec_')).toBeNull();
  });

  it('accepts a correctly signed, fresh delivery', () => {
    const body = '{"type":"payment.succeeded"}';
    expect(
      verifyYocoWebhook({
        rawBody: body,
        headers: {
          id: 'msg_1',
          timestamp: String(NOW),
          signature: sign('msg_1', String(NOW), body),
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('valid');
  });

  it('accepts any matching entry in a multi-signature header', () => {
    const body = '{}';
    const signature = `v1,bm90LXRoZS1yaWdodC1vbmU= ${sign('msg_2', String(NOW), body)}`;
    expect(
      verifyYocoWebhook({
        rawBody: body,
        headers: { id: 'msg_2', timestamp: String(NOW), signature },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('valid');
  });

  it('rejects a replayed signature outside the tolerance window', () => {
    const body = '{}';
    const timestamp = String(NOW - YOCO_SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(
      verifyYocoWebhook({
        rawBody: body,
        headers: {
          id: 'msg_3',
          timestamp,
          signature: sign('msg_3', timestamp, body),
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('invalid');
  });

  it('rejects a tampered body even with a real signature', () => {
    const timestamp = String(NOW);
    const signature = sign('msg_4', timestamp, '{"amount":100}');
    expect(
      verifyYocoWebhook({
        rawBody: '{"amount":10000}',
        headers: { id: 'msg_4', timestamp, signature },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('invalid');
  });

  it('rejects a signature made with a different key', () => {
    const body = '{}';
    const timestamp = String(NOW);
    const wrongKey = Buffer.from('someone-elses-key');
    expect(
      verifyYocoWebhook({
        rawBody: body,
        headers: {
          id: 'msg_5',
          timestamp,
          signature: sign('msg_5', timestamp, body, wrongKey),
        },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('invalid');
  });

  it('reports an unconfigured secret as unsigned, not invalid', () => {
    expect(
      verifyYocoWebhook({
        rawBody: '{}',
        headers: { id: 'msg_6', timestamp: String(NOW), signature: 'v1,abc' },
        secret: undefined,
        nowSeconds: NOW,
      }),
    ).toBe('unsigned');
  });

  it('rejects a delivery missing any signed header', () => {
    expect(
      verifyYocoWebhook({
        rawBody: '{}',
        headers: { id: 'msg_7', timestamp: String(NOW) },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('invalid');
    expect(
      verifyYocoWebhook({
        rawBody: '{}',
        headers: { id: 'msg_8', timestamp: 'not-a-number', signature: 'v1,abc' },
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe('invalid');
  });
});
