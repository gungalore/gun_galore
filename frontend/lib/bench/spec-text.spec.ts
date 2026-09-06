import { describe, it, expect } from 'vitest';
import {
  caseTypeText,
  headerMeta,
  isBeltedType,
  originText,
  tolerancesOf,
  withTolerance,
} from './spec-text';

describe('caseTypeText', () => {
  it('maps the four numbered shapes to plain words', () => {
    expect(caseTypeText('1 rimless')).toBe('Rimless');
    expect(caseTypeText('2 rimmed')).toBe('Rimmed');
    expect(caseTypeText('3 belted')).toBe('Belted');
    expect(caseTypeText('4 rebated')).toBe('Rebated');
  });

  it('strips the leading index from a shape it does not know', () => {
    // The number is an index into the sheet's own list. It means nothing to a
    // reloader, so it goes whether or not the word is recognised.
    expect(caseTypeText('5 semi-rimmed')).toBe('semi-rimmed');
  });

  it('accepts a shape printed without its index', () => {
    expect(caseTypeText('rimless')).toBe('Rimless');
    expect(caseTypeText('BELTED')).toBe('Belted');
  });

  it('treats absent, empty and index-only as nothing to print', () => {
    expect(caseTypeText(null)).toBeNull();
    expect(caseTypeText(undefined)).toBeNull();
    expect(caseTypeText('   ')).toBeNull();
    expect(caseTypeText('1')).toBeNull();
  });
});

describe('originText', () => {
  it('expands the codes that occur in the reference file', () => {
    expect(originText('US')).toBe('United States');
    expect(originText('GB')).toBe('United Kingdom');
    expect(originText('DE')).toBe('Germany');
    expect(originText('ZA')).toBe('South Africa');
    expect(originText('CZ')).toBe('Czech Republic');
  });

  it('is case-insensitive', () => {
    expect(originText('fi')).toBe('Finland');
  });

  it('prints an unknown code rather than dropping the only origin it was given', () => {
    expect(originText('XX')).toBe('XX');
  });

  it('treats absent and empty as nothing to print', () => {
    expect(originText(null)).toBeNull();
    expect(originText('')).toBeNull();
  });
});

describe('isBeltedType', () => {
  it('recognises a belted case however the shape is printed', () => {
    expect(isBeltedType('3 belted')).toBe(true);
    expect(isBeltedType('Belted')).toBe(true);
  });

  it('is false for every other shape and for nothing at all', () => {
    expect(isBeltedType('1 rimless')).toBe(false);
    expect(isBeltedType('2 rimmed')).toBe(false);
    expect(isBeltedType(null)).toBe(false);
  });
});

describe('headerMeta', () => {
  it('reads as the spec asks', () => {
    expect(headerMeta({ type: '1 rimless', origin: 'US', year: 2012 })).toBe(
      'Rimless · United States · 2012',
    );
  });

  it('drops the parts it has no answer for rather than printing separators', () => {
    expect(headerMeta({ type: null, origin: 'GB', year: 1888 })).toBe('United Kingdom · 1888');
    expect(headerMeta({ type: '2 rimmed', origin: null, year: null })).toBe('Rimmed');
    expect(headerMeta({})).toBe('');
  });
});

describe('tolerancesOf', () => {
  it('reads the printed tolerances off a loose dims record', () => {
    expect(tolerancesOf({ L1: 37.84, tolerances: { L1: '-0.20', P1: '±0.05' } })).toEqual({
      L1: '-0.20',
      P1: '±0.05',
    });
  });

  it('drops anything that is not a non-empty string, rather than coercing it', () => {
    // A tolerance is text as printed. A number here would have to be
    // re-formatted to show, and that would state a tolerance nobody wrote.
    expect(tolerancesOf({ tolerances: { L1: 0.2, L2: '', L3: null, L6: '-0.30' } })).toEqual({
      L6: '-0.30',
    });
  });

  it('survives the field being absent, null, an array or a scalar', () => {
    expect(tolerancesOf(null)).toEqual({});
    expect(tolerancesOf(undefined)).toEqual({});
    expect(tolerancesOf({})).toEqual({});
    expect(tolerancesOf({ tolerances: null })).toEqual({});
    expect(tolerancesOf({ tolerances: ['-0.20'] })).toEqual({});
    expect(tolerancesOf({ tolerances: 'nope' })).toEqual({});
  });
});

describe('withTolerance', () => {
  it('appends the printed tolerance with a real minus sign', () => {
    expect(withTolerance('37.84 mm (1.490″)', '-0.20')).toBe('37.84 mm (1.490″) −0.20');
  });

  it('leaves the value alone when there is no tolerance', () => {
    expect(withTolerance('37.84 mm', undefined)).toBe('37.84 mm');
    expect(withTolerance('37.84 mm', '  ')).toBe('37.84 mm');
  });

  it('does not otherwise rewrite what the sheet printed', () => {
    expect(withTolerance('11.95 mm', '±0.05')).toBe('11.95 mm ±0.05');
    expect(withTolerance('11.95 mm', '+0.30/-0.10')).toBe('11.95 mm +0.30/−0.10');
  });
});
