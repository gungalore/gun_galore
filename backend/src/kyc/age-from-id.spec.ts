import { ageFromSaIdNumber } from './kyc-cross-check';

// Age is derived from the ID number's own YYMMDD prefix so the vision model
// can be told the size of the age gap as a fact. Getting the century wrong
// would hand it a 100-year error, so the boundary cases are pinned here.
describe('ageFromSaIdNumber', () => {
  const now = new Date(Date.UTC(2026, 7, 13)); // 2026-08-13

  it('reads a 20th-century birth date', () => {
    // 800101… → 1 Jan 1980 → 46 in Aug 2026
    expect(ageFromSaIdNumber('8001015009087', now)).toBe(46);
  });

  it('has not counted a birthday that has not happened yet this year', () => {
    // 801231… → 31 Dec 1980; on 13 Aug 2026 they are still 45.
    expect(ageFromSaIdNumber('8012315009087', now)).toBe(45);
  });

  it('counts the birthday on the day itself', () => {
    // 800813… → 13 Aug 1980, and today is 13 Aug 2026.
    expect(ageFromSaIdNumber('8008135009087', now)).toBe(46);
  });

  it('reads a 21st-century birth date', () => {
    // 050101… → 1 Jan 2005 → 21 in Aug 2026
    expect(ageFromSaIdNumber('0501015009087', now)).toBe(21);
  });

  it('does not place a birth date in the future (century boundary)', () => {
    // '99' must be 1999, never 2099.
    expect(ageFromSaIdNumber('9901015009087', now)).toBe(27);
  });

  it('returns null for impossible dates rather than guessing', () => {
    expect(ageFromSaIdNumber('8002315009087', now)).toBeNull(); // 31 Feb
    expect(ageFromSaIdNumber('8013015009087', now)).toBeNull(); // month 13
    expect(ageFromSaIdNumber('8001005009087', now)).toBeNull(); // day 0
  });

  it('returns null for unusable input rather than throwing', () => {
    expect(ageFromSaIdNumber('', now)).toBeNull();
    expect(ageFromSaIdNumber('123', now)).toBeNull();
    expect(ageFromSaIdNumber(undefined as unknown as string, now)).toBeNull();
  });

  it('tolerates formatting characters', () => {
    expect(ageFromSaIdNumber('800101 5009 087', now)).toBe(46);
  });
});
