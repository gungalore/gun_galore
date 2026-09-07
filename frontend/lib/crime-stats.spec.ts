import { describe, expect, it } from 'vitest';
import {
  groupThousands,
  pickHeadlineCategories,
  stationLabel,
  yoyChip,
} from './crime-stats';
import type { PrecinctCategoryFigures } from './motivations-api';

function cat(
  category: string,
  overrides: Partial<PrecinctCategoryFigures> = {},
): PrecinctCategoryFigures {
  return {
    category,
    latest: { period: '2026Q2', label: 'Apr–Jun 2026', count: 10 },
    sameQuarterLastYear: null,
    recent: [],
    yearOnYearPct: null,
    lastTwelveMonths: 40,
    ...overrides,
  };
}

describe('stationLabel', () => {
  it('joins name, district and province with the house separator', () => {
    expect(
      stationLabel({
        name: 'Sea Point',
        district: 'Cape Town',
        province: 'Western Cape',
      }),
    ).toBe('Sea Point · Cape Town, Western Cape');
  });
});

describe('pickHeadlineCategories', () => {
  it('returns everything, unfiltered, when there are already ≤ limit', () => {
    const cats = [cat('Murder'), cat('Common assault')];
    expect(pickHeadlineCategories(cats)).toEqual(cats);
  });

  it('leads with preferred categories over bigger but irrelevant ones', () => {
    const murder = cat('Murder');
    const shoplifting = cat('Shoplifting');
    const burglary = cat('Burglary at residential premises');
    const drugs = cat('Drug-related crime');
    const assault = cat('Assault GBH');
    const cats = [shoplifting, drugs, murder, burglary, assault];

    const picked = pickHeadlineCategories(cats, 4);

    expect(picked).toHaveLength(4);
    expect(picked).toContain(murder);
    expect(picked).toContain(burglary);
    expect(picked).toContain(assault);
    // Only one of the two non-preferred categories fits in the remaining slot.
    expect(picked.filter((c) => c === shoplifting || c === drugs)).toHaveLength(1);
  });

  it('matches preferred category names case-insensitively', () => {
    const cats = [
      cat('MURDER'),
      cat('Something else'),
      cat('Another category'),
      cat('A third one'),
      cat('A fourth one'),
    ];
    const picked = pickHeadlineCategories(cats, 4);
    expect(picked[0].category).toBe('MURDER');
  });

  it('never invents categories the release did not send', () => {
    const cats = [cat('Malicious damage to property')];
    expect(pickHeadlineCategories(cats, 4)).toEqual(cats);
  });

  it('does not pick the same category twice when its name matches two preferences', () => {
    // "robbery aggravating circumstances" and "aggravated robbery" both name
    // the same real-world category under different wording; a release only
    // ever sends one of them.
    const cats = [
      cat('Robbery aggravating circumstances'),
      cat('Murder'),
      cat('Burglary at residential premises'),
      cat('Assault GBH'),
      cat('Common robbery'),
    ];
    const picked = pickHeadlineCategories(cats, 4);
    const names = picked.map((c) => c.category);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('yoyChip', () => {
  it('returns null when there is nothing to compare against', () => {
    expect(yoyChip(null)).toBeNull();
  });

  it('is amber and plus-signed for a rise', () => {
    expect(yoyChip(12.4)).toEqual({ text: '+12.4%', tone: 'amber' });
  });

  it('is neutral, never red, for a fall', () => {
    const chip = yoyChip(-8.3);
    expect(chip?.tone).toBe('neutral');
    expect(chip?.text).toBe('−8.3%');
  });

  it('is neutral and reads 0% for no change', () => {
    expect(yoyChip(0)).toEqual({ text: '0%', tone: 'neutral' });
  });

  it('rounds to one decimal place', () => {
    expect(yoyChip(12.449)).toEqual({ text: '+12.4%', tone: 'amber' });
  });
});

describe('groupThousands', () => {
  it('groups by thousands with a plain space', () => {
    expect(groupThousands(63092)).toBe('63 092');
  });

  it('leaves small numbers alone', () => {
    expect(groupThousands(42)).toBe('42');
  });

  it('rounds a fractional count', () => {
    expect(groupThousands(1234.6)).toBe('1 235');
  });
});
