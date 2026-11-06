import { describe, expect, it } from 'vitest';
import { isAppHost, stripToAppPath } from './app-url';

/**
 * These cases are the ones that actually bite in production:
 *
 *  - a row written on a tunnel keeps that hostname forever, so its tap has to
 *    resolve to the PATH (the app is on a different host by then);
 *  - a genuinely external link must stay external — the previous
 *    implementation's `endsWith('trycloudflare.com')` is the reason this suite
 *    insists on a dot boundary;
 *  - the service worker passes its own origin, and a same-origin URL on a host
 *    nobody listed still belongs to the app.
 */
describe('stripToAppPath', () => {
  it('leaves a path, a hash and an empty string alone', () => {
    expect(stripToAppPath('/licence-centre/abc')).toBe('/licence-centre/abc');
    expect(stripToAppPath('#buy-panel')).toBe('#buy-panel');
    expect(stripToAppPath('')).toBe('');
  });

  it('reduces an own-origin absolute URL to its path, query and hash', () => {
    expect(
      stripToAppPath(
        'https://alloutdoor.co.za/checkout/offer/xyz?ref=push#pay',
        'https://alloutdoor.co.za',
      ),
    ).toBe('/checkout/offer/xyz?ref=push#pay');
  });

  it('reduces a known app host even when the caller is on another one', () => {
    // The row was written on www, the member is on the apex. Both are ours.
    expect(
      stripToAppPath('https://www.alloutdoor.co.za/my/orders', 'https://alloutdoor.co.za'),
    ).toBe('/my/orders');
  });

  it('reduces the retired-brand host, so old rows keep working', () => {
    expect(stripToAppPath('https://gungalore.co.za/listings/9', 'https://alloutdoor.co.za')).toBe(
      '/listings/9',
    );
  });

  it('reduces a dev tunnel and a localhost URL to their paths', () => {
    expect(
      stripToAppPath(
        'https://gathered-uncle.trycloudflare.com/a/x5-dvrr',
        'https://alloutdoor.co.za',
      ),
    ).toBe('/a/x5-dvrr');
    expect(stripToAppPath('http://localhost:3000/checkout/offer/abc', 'https://alloutdoor.co.za')).toBe(
      '/checkout/offer/abc',
    );
  });

  it('keeps a third-party link absolute', () => {
    const external = 'https://drive.google.com/file/d/123';
    expect(stripToAppPath(external, 'https://alloutdoor.co.za')).toBe(external);
  });

  it('does not mistake a lookalike host for ours', () => {
    const lookalike = 'https://nottrycloudflare.com/a/token';
    expect(stripToAppPath(lookalike, 'https://alloutdoor.co.za')).toBe(lookalike);
    const suffixed = 'https://alloutdoor.co.za.evil.example/x';
    expect(stripToAppPath(suffixed, 'https://alloutdoor.co.za')).toBe(suffixed);
  });

  it('keeps a non-http scheme and an unparseable string untouched', () => {
    expect(stripToAppPath('mailto:help@alloutdoor.co.za')).toBe(
      'mailto:help@alloutdoor.co.za',
    );
    expect(stripToAppPath('not a url')).toBe('not a url');
  });

  it('treats a same-origin URL as ours even on a host nobody listed', () => {
    // The service worker's answer, on whatever hostname the deploy uses.
    expect(stripToAppPath('https://staging.internal/x', 'https://staging.internal')).toBe('/x');
  });
});

describe('isAppHost', () => {
  it('accepts our hosts and their subdomains, on a dot boundary', () => {
    expect(isAppHost('alloutdoor.co.za')).toBe(true);
    expect(isAppHost('www.alloutdoor.co.za')).toBe(true);
    expect(isAppHost('shop.gungalore.co.za')).toBe(true);
    expect(isAppHost('abc.trycloudflare.com')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppHost('example.com')).toBe(false);
    expect(isAppHost('alloutdoor.co.za.example.com')).toBe(false);
  });
});
