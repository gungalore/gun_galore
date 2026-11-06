import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './vapid-key';

/**
 * The value here is not the conversion — it is that the SAME conversion is used
 * by the opt-in button (lib/use-push.ts) and by the worker when it re-subscribes
 * (app/sw.ts). A padding or alphabet mistake in one of them produces a
 * subscription the push service accepts and then never delivers to, which is
 * invisible until somebody wonders why their phone is quiet.
 *
 * Vectors are hand-checked Base64: 'AQAB' is the canonical VAPID key prefix
 * (the uncompressed P-256 point header 0x04 is not, but the low bytes of a
 * real key look exactly like this), and '-_8' exercises the two URL-safe
 * characters that differ from standard Base64.
 */
describe('urlBase64ToUint8Array', () => {
  it('decodes the canonical key prefix', () => {
    expect([...urlBase64ToUint8Array('AQAB')]).toEqual([1, 0, 1]);
  });

  it('adds the padding Base64URL strips', () => {
    // 2 chars = 1 byte, no '=' in the URL-safe form.
    expect([...urlBase64ToUint8Array('AQ')]).toEqual([1]);
  });

  it('maps - and _ to + and /', () => {
    // '-_8' is '+/8' in standard Base64.
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });

  it('returns a buffer-backed array, not a shared one', () => {
    const bytes = urlBase64ToUint8Array('AQAB');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect(bytes.byteLength).toBe(bytes.length);
  });
});
