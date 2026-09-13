import { describe, it, expect } from 'vitest';
import { resolveShortCode } from './t-route';

// ⚠️ `.spec.ts` here IS correct — this is under lib/, not components/. The
// frontend's vitest include is ['lib/**/*.spec.ts', 'components/**/*.spec.tsx']
// (note the x on the components pattern); a lib spec written as .spec.tsx
// would be the one that goes uncollected here, not the reverse.

describe('resolveShortCode', () => {
  it('maps a transaction code to the transaction page', () => {
    expect(resolveShortCode('tclhq3v9m0000abc123defg')).toBe(
      '/transactions/clhq3v9m0000abc123defg',
    );
  });

  it('maps an order code to the order page', () => {
    expect(resolveShortCode('oclhq3v9m0000abc123defg')).toBe(
      '/orders/clhq3v9m0000abc123defg',
    );
  });

  it('maps the three argument-free codes', () => {
    expect(resolveShortCode('p')).toBe('/profile/edit');
    expect(resolveShortCode('b')).toBe('/my/orders');
    expect(resolveShortCode('s')).toBe('/my/sales');
  });

  it('falls through to / for an unknown prefix', () => {
    expect(resolveShortCode('xabc123')).toBe('/');
    expect(resolveShortCode('q')).toBe('/');
  });

  it('falls through to / for an empty code', () => {
    expect(resolveShortCode('')).toBe('/');
  });

  it('falls through to / for a code whose id half is too short or too long', () => {
    expect(resolveShortCode('t')).toBe('/');
    expect(resolveShortCode('tab')).toBe('/');
    expect(resolveShortCode('t' + 'a'.repeat(41))).toBe('/');
  });

  // The open-redirect guard. None of these may ever reach the Location
  // header or be treated as a valid id.
  it('never reflects a path traversal or absolute URL into the result', () => {
    expect(resolveShortCode('t../../etc/passwd')).toBe('/');
    expect(resolveShortCode('thttps://evil.example.com')).toBe('/');
    expect(resolveShortCode('t//evil.example.com')).toBe('/');
    expect(resolveShortCode('o/../../admin')).toBe('/');
    expect(resolveShortCode('thttp://evil.example.com/x')).toBe('/');
  });

  it('rejects an id containing punctuation even if otherwise plausible-length', () => {
    expect(resolveShortCode('tabc-123-def-456-ghi-789')).toBe('/');
    expect(resolveShortCode('tabc.123.def.456.ghi.789')).toBe('/');
  });

  it('is case-insensitive on the id but keeps the kind prefix literal', () => {
    expect(resolveShortCode('tABC123DEF456GHI789JKL')).toBe(
      '/transactions/ABC123DEF456GHI789JKL',
    );
    // 'T' (uppercase) is not the recognised 't' kind prefix.
    expect(resolveShortCode('Tabc123def456ghi789jkl')).toBe('/');
  });
});
