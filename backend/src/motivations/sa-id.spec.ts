import { readSaId, splitName } from './sa-id';

// These values go into boxes on a form the applicant signs, so the rule
// throughout is: return null rather than guess. An empty box they fill in
// themselves is fine; a wrong date of birth is not.

describe('readSaId', () => {
  // The Luhn-valid test ID already used elsewhere in this codebase.
  const VALID = '8001015009087';
  const AS_AT = new Date(Date.UTC(2026, 7, 18)); // 18 Aug 2026

  it('reads date of birth, age, gender and citizenship', () => {
    const f = readSaId(VALID, AS_AT);
    expect(f.valid).toBe(true);
    expect(f.dateOfBirth?.toISOString().slice(0, 10)).toBe('1980-01-01');
    expect(f.age).toBe(46);
    expect(f.gender).toBe('male'); // sequence 5009 >= 5000
    expect(f.citizenship).toBe('sa_citizen');
  });

  it('reads female from a sequence below 5000', () => {
    // Same date, female sequence, recomputed check digit.
    const f = readSaId('8001010009088', AS_AT);
    expect(f.gender).toBe('female');
  });

  it('does not count a birthday that has not happened yet this year', () => {
    const beforeBirthday = readSaId(VALID, new Date(Date.UTC(2026, 0, 1)));
    expect(beforeBirthday.age).toBe(46);
    const dayBefore = readSaId(VALID, new Date(Date.UTC(2025, 11, 31)));
    expect(dayBefore.age).toBe(45);
  });

  it('puts a two-digit year in the right century', () => {
    // 26 would be 2026 — in the future — so it must read as 1926.
    const old = readSaId('2601015009087', AS_AT);
    expect(old.dateOfBirth?.getUTCFullYear()).toBe(1926);
    // 05 is comfortably in the past, so 2005.
    const young = readSaId('0501015009087', AS_AT);
    expect(young.dateOfBirth?.getUTCFullYear()).toBe(2005);
  });

  it('rejects an impossible date rather than rolling it over', () => {
    // 31 February would silently become 3 March if we trusted Date.
    const f = readSaId('8002315009087', AS_AT);
    expect(f.dateOfBirth).toBeNull();
    expect(f.age).toBeNull();
  });

  it('reports an invalid check digit without throwing away the rest', () => {
    const f = readSaId('8001015009088', AS_AT); // last digit wrong
    expect(f.valid).toBe(false);
    // Still readable — the wizard shows a warning rather than losing the data.
    expect(f.dateOfBirth).not.toBeNull();
  });

  it('returns nothing at all for junk', () => {
    for (const junk of ['', '123', 'not an id', '80010150090871']) {
      const f = readSaId(junk, AS_AT);
      expect(f).toEqual({
        dateOfBirth: null,
        age: null,
        gender: null,
        citizenship: null,
        valid: false,
      });
    }
  });

  it('tolerates spacing, which is how people write it', () => {
    expect(readSaId('800101 5009 08 7', AS_AT).valid).toBe(true);
  });

  it('never reads the apartheid-era race digit', () => {
    // Digit 12 was a race classifier, abolished in 1994. Changing it must have
    // no effect on anything we return.
    const a = readSaId('8001015009087', AS_AT);
    const b = readSaId('8001015009182', AS_AT);
    expect(b.dateOfBirth?.toISOString()).toBe(a.dateOfBirth?.toISOString());
    expect(b.gender).toBe(a.gender);
  });

  it('is reproducible — age comes from the injected date, not the clock', () => {
    // A document re-rendered months later must reproduce the age it was
    // generated with.
    expect(readSaId(VALID, new Date(Date.UTC(2030, 0, 2))).age).toBe(50);
  });
});

describe('splitName', () => {
  it('splits a plain name', () => {
    expect(splitName('Jan Pieter Botha')).toEqual({
      firstNames: 'Jan Pieter',
      surname: 'Botha',
      initials: 'JP',
    });
  });

  it('keeps Afrikaans compound surnames together', () => {
    // "Van der Merwe" is the surname, not "Merwe". Getting this wrong puts a
    // misspelt surname on a licence application.
    expect(splitName('Pieter van der Merwe')).toMatchObject({
      surname: 'van der Merwe',
      initials: 'P',
    });
    expect(splitName('Anna Maria du Plessis')).toMatchObject({
      surname: 'du Plessis',
      initials: 'AM',
    });
    expect(splitName('Gerhard Johan Petrus Fourie')).toMatchObject({
      surname: 'Fourie',
      initials: 'GJP',
    });
  });

  it('handles a single word and empty input without throwing', () => {
    expect(splitName('Mokoena')).toMatchObject({ surname: 'Mokoena' });
    expect(splitName('')).toEqual({ firstNames: '', surname: '', initials: '' });
  });

  it('collapses stray whitespace', () => {
    expect(splitName('  Jan   Botha  ')).toMatchObject({
      surname: 'Botha',
      initials: 'J',
    });
  });
});
