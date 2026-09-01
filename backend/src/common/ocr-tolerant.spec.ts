import { clauseMatches, hasPhrase, looseWord, phrase } from './ocr-tolerant';

// The real heading off the operator's paper competency certificate, and the
// one the measurement showed is the most fragile anchor in the whole table.
const SECTION_10 = 'section 10 of the firearms control act';

describe('a phrase survives the substitutions an engine actually makes', () => {
  it('matches the clean text', () => {
    expect(hasPhrase(SECTION_10, SECTION_10)).toBe(true);
  });

  it('matches when digits and letters are swapped for their lookalikes', () => {
    // 1<->l, 0<->O, 5<->S: exactly what a low-resolution read does.
    expect(
      hasPhrase('sectlOn lO of the firearms contro1 act', SECTION_10),
    ).toBe(true);
    expect(
      hasPhrase('SECTI0N 1O OF THE FIREARM5 CONTROL ACT', SECTION_10),
    ).toBe(true);
  });

  it('⚠️ SURVIVES ONE WORD BEING DESTROYED OUTRIGHT', () => {
    // This is the redundancy the fragile documents lacked. At 99.5% character
    // accuracy the old plastic competency card was already misclassified 22%
    // of the time, because one bad character anywhere in a 38-character phrase
    // removed its only anchor.
    expect(
      hasPhrase('section 10 of the fjrearrns control act', SECTION_10, {
        allowMissing: 1,
      }),
    ).toBe(true);
  });

  it('does NOT survive a word being destroyed when no allowance is given', () => {
    expect(
      hasPhrase('section 10 of the fjrearrns control act', SECTION_10),
    ).toBe(false);
  });

  it('⚠️ WILL NOT LET THE DISTINCTIVE WORD BE THE MISSING ONE', () => {
    // Allowance without this is a false positive generator: "competency
    // certificate" with one word optional matches any page carrying the word
    // "certificate", which every training provider's certificate has.
    expect(
      hasPhrase(
        'this is a certificate of attendance',
        'competency certificate',
        {
          allowMissing: 1,
          required: ['competency'],
        },
      ),
    ).toBe(false);
    expect(
      hasPhrase('competency cert1f1cate', 'competency certificate', {
        allowMissing: 1,
        required: ['competency'],
      }),
    ).toBe(true);
  });

  it('requires the words in order, so a bag of common words is not a match', () => {
    expect(
      hasPhrase('certificate of competency', 'competency certificate'),
    ).toBe(false);
  });

  it('tolerates whatever whitespace and punctuation the layout produces', () => {
    expect(
      hasPhrase('Section  10\n  of the\tFirearms Control Act,', SECTION_10),
    ).toBe(true);
  });

  it('does not match an unrelated document', () => {
    const other =
      'application for a renewal of a firearm licence in terms of the act';
    expect(hasPhrase(other, SECTION_10, { allowMissing: 1 })).toBe(false);
  });
});

describe('looseWord', () => {
  it('accepts the lookalikes and rejects a genuinely different word', () => {
    expect(looseWord('firearms').test('fjrearms')).toBe(false);
    expect(looseWord('control').test('contro1')).toBe(true);
    expect(looseWord('2000').test('z0O0')).toBe(true);
    expect(looseWord('rifle').test('table')).toBe(false);
  });
});

describe('clauseMatches reports HOW well it matched, not just whether', () => {
  it('takes a RegExp unchanged, and calls it exact', () => {
    expect(clauseMatches(/saps\s*524/i, 'form SAPS 524 rev 3')).toBe('exact');
    expect(clauseMatches(/saps\s*524/i, 'form SAPS 271')).toBe(false);
  });

  it('calls a clean phrase exact, even with lookalike substitutions', () => {
    // A substitution is something we can read THROUGH with confidence: a 1 for
    // an l is a known glyph collision, not a missing word.
    const p = phrase('licence to possess a firearm', { allowMissing: 1 });
    expect(clauseMatches(p, 'LICENCE TO POSSESS A FIREARM')).toBe('exact');
    expect(clauseMatches(p, 'l1cence to possess a f1rearm')).toBe('exact');
    expect(clauseMatches(p, 'application for something else')).toBe(false);
  });

  it('⚠️ CALLS IT LOOSE WHEN A WORD HAD TO BE GIVEN UP', () => {
    // This is the distinction the whole safety property rests on. readMarkers
    // downgrades a verdict built on a loose match out of 'definitive', and
    // motivation-extract.service.ts only skips the model for a definitive one
    // — so a damaged document gets confirmed instead of auto-filed.
    const p = phrase('licence to possess a firearm', { allowMissing: 1 });
    expect(clauseMatches(p, 'licence to p0ss3zz a firearm')).toBe('loose');
  });
});

describe('⚠️ A PHRASE IS NOT A BAG OF WORDS ANYWHERE ON THE PAGE', () => {
  // Both faults below were found by running PP-OCRv5's server model over the
  // operator's real scans: legitimate SAPS 524 competency certificates came
  // back vetoed as SAPS 518 APPLICATIONS — the worst misclassification this
  // table exists to prevent, caused by the tolerance meant to help.

  it('will not join two words 465 characters apart', () => {
    // The exact shape of the real failure: "SAPS" in the form number at the
    // top of the page, and a "518"-lookalike deep in the body text.
    const page =
      'SAPS524\nCOMPETENCY CERTIFICATE\n' +
      'x'.repeat(400) +
      '\nIt is hereby certified that the above person has completed the prescribed training';
    expect(hasPhrase(page, 'SAPS 518')).toBe(false);
  });

  it('still matches a real form number with ordinary spacing', () => {
    expect(hasPhrase('form SAPS 518 rev 2', 'SAPS 518')).toBe(true);
    expect(hasPhrase('SAPS518', 'SAPS 518')).toBe(true);
    expect(hasPhrase('SAPS\n518', 'SAPS 518')).toBe(true);
  });

  it('⚠️ A NUMBER MAY NOT MATCH THE MIDDLE OF AN ENGLISH WORD', () => {
    // looseWord('518') becomes [5sS][1lIi|][8bB], which matches the letters
    // s-i-b — and "prescribed" contains exactly that. Digit tolerance has to
    // survive an engine reading 518 as S18, without eating every word that
    // happens to contain those letters.
    expect(looseWord('518').test('prescribed')).toBe(false);
    expect(looseWord('518').test('possible')).toBe(false);
    expect(looseWord('518').test('S18')).toBe(true);
    expect(looseWord('518').test('5l8')).toBe(true);
    expect(looseWord('271').test('form 27l here')).toBe(true);
  });

  it('does not veto a competency certificate as an application', () => {
    // End to end, on the shape that actually failed.
    const saps524 =
      'SAPS524\nSOUTHAFRICANPOLICESERVICE\nCOMPETENCYCERTIFICATE\n' +
      'Section10oftheFirearmsControlAct,2000\n' +
      'Itisherebycertifiedthatthepersonhascompletedtheprescribedtraining';
    expect(hasPhrase(saps524, 'SAPS 518')).toBe(false);
    expect(hasPhrase(saps524, 'SAPS 271')).toBe(false);
  });
});
