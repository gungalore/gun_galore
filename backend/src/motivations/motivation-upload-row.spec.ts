import {
  ROW_CAUTION_DAYS,
  competencyCovers,
  expiryFromReading,
  uploadCaution,
} from './motivation-upload-row';

// ────────────────────────────────────────────────────────────────────
// The date a DFO checks first, and the endorsement a licence turns on.
// ────────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-09-06T00:00:00Z');
const inDays = (n: number) =>
  new Date(TODAY.getTime() + n * 86_400_000).toISOString().slice(0, 10);

describe('what a document row says about its own validity', () => {
  it('says nothing at all about a document with no expiry', () => {
    // An ID copy, a statement of results, a photograph of a safe. Inventing a
    // warning for a date that does not exist would be crying wolf on most of a
    // pack, and a warning nobody can act on is one people learn to ignore.
    expect(uploadCaution(null, TODAY)).toBeNull();
  });

  it('is red once the date has passed', () => {
    const c = uploadCaution(inDays(-1), TODAY);
    expect(c?.tone).toBe('red');
    // The date itself, so the member can check it against the paper.
    expect(c?.text).toContain(inDays(-1));
  });

  it('is amber inside three months', () => {
    // ⚠️ NINETY DAYS IS NOT "NEARLY EXPIRED", IT IS "EXPIRED BY THE TIME THIS
    // IS READ". SAPS takes months over an application.
    expect(uploadCaution(inDays(ROW_CAUTION_DAYS - 1), TODAY)?.tone).toBe(
      'amber',
    );
  });

  it('is silent at exactly ninety days and beyond', () => {
    expect(uploadCaution(inDays(ROW_CAUTION_DAYS), TODAY)).toBeNull();
    expect(uploadCaution(inDays(400), TODAY)).toBeNull();
  });

  it('says nothing about a date it cannot read', () => {
    // Rather than a warning about a document that may be perfectly good.
    expect(uploadCaution('sometime in 2027', TODAY)).toBeNull();
  });
});

describe('the expiry a reading carries', () => {
  it('takes a full yyyy-mm-dd off any of the keys the extractor uses', () => {
    expect(expiryFromReading({ expires_on: '2027-01-31' })).toBe('2027-01-31');
    expect(expiryFromReading({ valid_until: '2027-01-31' })).toBe('2027-01-31');
  });

  it('⚠️ REFUSES A PARTIAL DATE', () => {
    // Vision returns "2027" and "June 2027" often enough. Coercing one into a
    // full day would be inventing the deadline we then warn on.
    expect(expiryFromReading({ expires_on: '2027' })).toBeNull();
    expect(expiryFromReading({ expires_on: 'June 2027' })).toBeNull();
    expect(expiryFromReading(null)).toBeNull();
    expect(expiryFromReading({})).toBeNull();
  });
});

describe('whether a competency covers the firearm applied for', () => {
  it('accepts a certificate whose endorsements include what is needed', () => {
    expect(competencyCovers('N/S/L RIFLE/CARBINE', 'rifle-mo')).toBe(true);
  });

  it('refuses one that demonstrably does not', () => {
    expect(competencyCovers('HANDGUN', 'rifle-mo')).toBe(false);
  });

  it('⚠️ TREATS UNKNOWN AS A YES, IN BOTH DIRECTIONS', () => {
    // Three separate things can be unknown: the application has not said what
    // firearm it is for, the covers line was never read, or it was read and
    // parsed to nothing. In none of them do we KNOW the certificate is wrong,
    // and refusing on a fact we do not hold would withhold a member's own
    // document from their own application on a guess.
    expect(competencyCovers('HANDGUN', null)).toBe(true);
    expect(competencyCovers('', 'rifle-mo')).toBe(true);
    expect(competencyCovers('something nobody can parse', 'rifle-mo')).toBe(
      true,
    );
  });

  it('reads the compound SAPS form, where one action distributes', () => {
    // "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN" is copied off a real certificate.
    const covers = 'S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN';
    expect(competencyCovers(covers, 'rifle-sl')).toBe(true);
    expect(competencyCovers(covers, 'shotgun')).toBe(true);
  });
});
