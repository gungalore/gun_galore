import { editDistance, namesMatch, normaliseName } from './motivation-name-match';

describe('normaliseName', () => {
  it('drops case, spaces and punctuation', () => {
    expect(normaliseName('12 Gauge')).toBe('12gauge');
    expect(normaliseName('.30-06 Springfield')).toBe('3006springfield');
    expect(normaliseName('CZ 600 Plus American')).toBe('cz600plusamerican');
  });
});

describe('editDistance', () => {
  it('counts a missing letter as one', () => {
    expect(editDistance('mosberg', 'mossberg')).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// MO000063: the applicant typed `mosberg` and `12 gayge`; the writer wrote
// "Mossberg" and "12 Gauge"; the validators refused the corrected prose.
// ────────────────────────────────────────────────────────────────────
describe('namesMatch', () => {
  it('accepts the corrected make for the recorded misspelling', () => {
    expect(namesMatch('Why is the Mossberg suited to this purpose?', 'mosberg')).toBe(
      true,
    );
  });

  it('accepts the corrected calibre for the recorded misspelling', () => {
    expect(namesMatch('Why is the Mossberg, in 12 Gauge, suited?', '12 gayge')).toBe(
      true,
    );
  });

  it('accepts an exact name regardless of case and spacing', () => {
    expect(namesMatch('the MOSSBERG 500', 'Mossberg')).toBe(true);
    expect(namesMatch('a .30-06 Springfield rifle', '30-06 springfield')).toBe(true);
  });

  it('accepts the misspelling in the held list for the corrected name', () => {
    expect(namesMatch('mosberg 500 shotgun', 'Mossberg')).toBe(true);
  });

  // ⚠️ THE WHOLE POINT OF A BOUNDED TOLERANCE: a different make still fails.
  it('refuses a genuinely different make', () => {
    expect(namesMatch('Why is the Mossberg suited?', 'Sako')).toBe(false);
    expect(namesMatch('Why is the Beretta suited?', 'Mossberg')).toBe(false);
  });

  it('refuses a two-letter make unless it is there exactly', () => {
    expect(namesMatch('a CZ 600 rifle', 'CZ')).toBe(true);
    expect(namesMatch('a Glock 19', 'CZ')).toBe(false);
  });

  it('refuses empty input', () => {
    expect(namesMatch('', 'Mossberg')).toBe(false);
    expect(namesMatch('Mossberg', '')).toBe(false);
  });
});
