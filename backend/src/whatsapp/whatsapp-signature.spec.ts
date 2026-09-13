import { createHmac } from 'crypto';
import { verifyMetaSignature } from './whatsapp-signature';

const SECRET = 'test-whatsapp-app-secret';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('accepts a valid signature', () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = JSON.stringify({ object: 'tampered', entry: [] });
    expect(verifyMetaSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects an empty header', () => {
    expect(verifyMetaSignature(body, '', SECRET)).toBe(false);
  });

  it('handles the sha256= prefix — rejects a header missing it', () => {
    const raw = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyMetaSignature(body, raw, SECRET)).toBe(false);
  });

  it('does not throw on a wrong-length signature', () => {
    expect(() =>
      verifyMetaSignature(body, 'sha256=deadbeef', SECRET),
    ).not.toThrow();
    expect(verifyMetaSignature(body, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('rejects when secret is empty', () => {
    expect(verifyMetaSignature(body, sign(body), '')).toBe(false);
  });

  it('accepts a Buffer body identically to the equivalent string', () => {
    const buf = Buffer.from(body, 'utf8');
    expect(verifyMetaSignature(buf, sign(body), SECRET)).toBe(true);
  });
});
