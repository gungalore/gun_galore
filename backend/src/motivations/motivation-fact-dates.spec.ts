import { MotivationLicenceType } from '@prisma/client';
import { gateUserPrompt, spelledDate } from './motivation-prompts';

// ────────────────────────────────────────────────────────────────────
// THE WRITER IS NEVER ASKED TO RETYPE TEN DIGITS.
//
// ⚠️ A WRONG DIGIT IN AN ISO DATE IS STILL A VALID DATE, which is what makes it
// a wrong FACT in a document somebody signs rather than a typo somebody spots.
// The wizard stores ISO and the fact pack used to hand it straight over, so the
// model's job in the association paragraph was to copy "2027-06-30" character
// by character. It kept failing:
//
//   2026-09-10 12:33   supplied 2027-06-30   drafted 2030-06-30   REFUSED
//   2026-09-10 11:56   supplied 2027-06-30   drafted 2030-06-30   REFUSED
//   2026-09-10 11:56   supplied 2024-06-07   drafted 2004-06-07   REFUSED
//
// Every one of those had the fact present, correct, and one keystroke away in
// the draft. Three attempts and a repair pass cannot help: the repair pass
// refuses a CLAIM on purpose, because mending one means choosing which fact was
// meant, and a model can pick a different supplied date, satisfy the check and
// still be wrong.
//
// So the fact pack spells the date. A slip now has to be a whole wrong word
// instead of one wrong character — and it is what the letter should always have
// said. "My membership remains valid until 2027-06-30" is a database row.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;

const ANSWERS = {
  firearm_type: 'Rifle',
  firearm_make: 'HOWA',
  firearm_calibre: '6.5MM CREEDMOOR',
  firearm_serial: 'B477423',
  association_name: 'SA HUNTERS',
  association_number: '108828',
  association_joined: '2024-06-07',
  association_expiry: '2027-06-30',
};

const text = () =>
  gateUserPrompt(
    { licenceType: S16, answers: ANSWERS, derived: {} } as never,
    'the drafted motivation',
  );

describe('spelledDate', () => {
  it('spells a whole ISO day', () => {
    expect(spelledDate('2027-06-30')).toBe('30 June 2027');
    expect(spelledDate('2024-06-07')).toBe('7 June 2024');
    expect(spelledDate('2022-08-13')).toBe('13 August 2022');
  });

  it('⚠️ HANDS BACK ANYTHING IT DOES NOT FULLY RECOGNISE', () => {
    /**
     * A formatter that quietly rewrote what it could not parse would be
     * inventing a fact about the applicant. Absent stays absent, and a value
     * we cannot read stays exactly as they gave it.
     */
    for (const odd of [
      '',
      '2027',
      '2027-06',
      'June 2027',
      '30/06/2027',
      '2027-06-30 to 2028-06-30',
      'on or about 2027-06-30',
    ]) {
      expect(spelledDate(odd)).toBe(odd);
    }
  });

  it('⚠️ REFUSES A DATE THE CALENDAR DOES NOT HAVE', () => {
    // Left alone rather than rolled over: 31 February is not 3 March, and a
    // formatter that silently corrected it would print a date nobody supplied.
    expect(spelledDate('2027-02-31')).toBe('2027-02-31');
    expect(spelledDate('2027-13-01')).toBe('2027-13-01');
  });
});

describe('the fact pack', () => {
  it('⚠️ GIVES THE WRITER WORDS, NOT DIGITS TO RETYPE', () => {
    const t = text();
    expect(t).toContain('30 June 2027');
    expect(t).toContain('7 June 2024');
  });

  it('⚠️ AND THE ISO FORM IS GONE FROM IT', () => {
    // If this goes red the writer is being asked to copy digits again, and the
    // failures at the top of this file come back.
    const t = text();
    expect(t).not.toContain('2027-06-30');
    expect(t).not.toContain('2024-06-07');
  });

  it('leaves everything that is not a date alone', () => {
    const t = text();
    expect(t).toContain('B477423');
    expect(t).toContain('108828');
  });
});
