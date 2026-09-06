import { describe, expect, it } from 'vitest';
import { UNKNOWN_MAKER, bulletLabel, projectileName } from './contract';

/**
 * The 2026-09-06 import keeps the rows the powder-maker manuals print with no
 * bullet brand, filed under the maker "Unknown". That word is a group key; a
 * member must never read it as a company name.
 */
describe('projectileName', () => {
  it('names maker and type when both are known', () => {
    expect(projectileName({ bulletMaker: 'Hornady', bulletType: 'ELD Match' })).toBe(
      'Hornady ELD Match',
    );
  });

  it('drops the Unknown maker and keeps the type', () => {
    expect(projectileName({ bulletMaker: UNKNOWN_MAKER, bulletType: 'Spitzer' })).toBe('Spitzer');
  });

  it('falls back to the category, then to "bullet", when neither is printed', () => {
    expect(
      projectileName({ bulletMaker: UNKNOWN_MAKER, bulletType: '', bulletCategory: 'SP' }),
    ).toBe('SP');
    expect(
      projectileName({ bulletMaker: UNKNOWN_MAKER, bulletType: '', bulletCategory: 'OTHER' }),
    ).toBe('bullet');
    expect(projectileName({ bulletMaker: UNKNOWN_MAKER, bulletType: '' })).toBe('bullet');
  });

  it('never starts with a space and never prints the word Unknown', () => {
    for (const row of [
      { bulletMaker: UNKNOWN_MAKER, bulletType: '' },
      { bulletMaker: UNKNOWN_MAKER, bulletType: 'FBHP' },
      { bulletMaker: 'Sierra', bulletType: '' },
    ]) {
      const label = bulletLabel(row, 140);
      expect(label).not.toMatch(/^\s/);
      expect(label).not.toContain('Unknown');
      expect(label.endsWith(' 140 gr')).toBe(true);
    }
  });
});
