import { describe, expect, it } from 'vitest';
import { safeGateNext } from './gate-next';

describe('safeGateNext', () => {
  it('keeps a relative same-origin path, including query and hash', () => {
    expect(safeGateNext('/')).toBe('/');
    expect(safeGateNext('/marketplace?sort=new#top')).toBe(
      '/marketplace?sort=new#top',
    );
    expect(safeGateNext(['/listings/abc', '/ignored'])).toBe('/listings/abc');
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeGateNext('//evil.example')).toBe('/');
    expect(safeGateNext('https://evil.example')).toBe('/');
    expect(safeGateNext('http://evil.example/path')).toBe('/');
  });

  it('rejects backslash/control/overlong values', () => {
    expect(safeGateNext('/\\evil.example')).toBe('/');
    expect(safeGateNext('/path\u0000')).toBe('/');
    expect(safeGateNext(`/${'a'.repeat(2000)}`)).toBe('/');
  });

  it('falls back for missing/non-string input', () => {
    expect(safeGateNext(undefined)).toBe('/');
    expect(safeGateNext([])).toBe('/');
  });
});
