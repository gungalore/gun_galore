import {
  crossCheckIdentity,
  dobMatchesIdDigits,
  normaliseDob,
  saIdLuhnValid,
  type CrossCheckInput,
} from './kyc-cross-check';

// Canonical SA test ID: 800101 5009 08 7 — DOB 1980-01-01, Luhn-valid.
const ID = '8001015009087';

function input(overrides: Partial<CrossCheckInput> = {}): CrossCheckInput {
  return {
    enteredIdNumber: ID,
    enteredDob: '1980-01-01',
    doc: {
      idNumber: ID,
      surname: 'FOURIE',
      names: 'GERHARD',
      dob: '1980-01-01',
      legibility: 90,
      ...(overrides.doc ?? {}),
    },
    ha: {
      firstName: 'GERHARD',
      surname: 'FOURIE',
      dob: '1980-01-01',
      ...(overrides.ha ?? {}),
    },
    ...(({ doc, ha, ...rest }) => rest)(overrides),
  };
}

describe('saIdLuhnValid', () => {
  it('accepts the canonical valid ID', () => {
    expect(saIdLuhnValid(ID)).toBe(true);
  });
  it('rejects a checksum-broken ID', () => {
    expect(saIdLuhnValid('8001015009088')).toBe(false);
  });
  it('rejects wrong length / non-digits', () => {
    expect(saIdLuhnValid('900101500908')).toBe(false);
    expect(saIdLuhnValid('90010150090x7')).toBe(false);
    expect(saIdLuhnValid('')).toBe(false);
  });
});

describe('dobMatchesIdDigits', () => {
  it('matches when YYMMDD agrees', () => {
    expect(dobMatchesIdDigits(ID, '1980-01-01')).toBe(true);
  });
  it('fails on a different day', () => {
    expect(dobMatchesIdDigits(ID, '1980-01-02')).toBe(false);
  });
  it('fails on unparseable dob', () => {
    expect(dobMatchesIdDigits(ID, '01/01/1990')).toBe(false);
  });
});

describe('normaliseDob', () => {
  it.each([
    ['1980-01-01', '1980-01-01'],
    ['1980/01/01', '1980-01-01'],
    ['19800101', '1980-01-01'],
    ['1980-01-01T00:00:00Z', '1980-01-01'],
    ['garbage', ''],
    [null, ''],
    [undefined, ''],
  ])('normalises %p → %p', (raw, expected) => {
    expect(normaliseDob(raw as string | null | undefined)).toBe(expected);
  });
});

describe('crossCheckIdentity', () => {
  it('passes a fully consistent submission', () => {
    const r = crossCheckIdentity(input());
    expect(r.pass).toBe(true);
    expect(r.hardFails).toEqual([]);
    expect(r.softFails).toEqual([]);
  });

  it('HARD-fails when entered DOB disagrees with the ID digits (the silent catch-out)', () => {
    const r = crossCheckIdentity(input({ enteredDob: '1980-01-02' }));
    expect(r.hardFails).toContain('dob-id-digit-mismatch');
    // The failure key must never name DOB in user-facing copy — the key
    // itself is internal; assert it exists and nothing here is surfaced.
    expect(r.pass).toBe(false);
  });

  it('HARD-fails when Home Affairs DOB disagrees with entered DOB', () => {
    const r = crossCheckIdentity(
      input({ enteredDob: '1980-01-01', ha: { firstName: 'G', surname: 'FOURIE', dob: '1981-05-05' } }),
    );
    expect(r.hardFails).toContain('dob-ha-mismatch');
  });

  it('skips the HA check when Basic returns no dob', () => {
    const r = crossCheckIdentity(
      input({ ha: { firstName: 'G', surname: 'FOURIE', dob: '' } }),
    );
    expect(r.hardFails).toEqual([]);
  });

  it('SOFT-fails a 1-digit OCR slip on the document ID', () => {
    const r = crossCheckIdentity(
      input({ doc: { idNumber: '8001015009088', surname: 'FOURIE', names: 'G', dob: '1980-01-01', legibility: 90 } }),
    );
    expect(r.softFails).toContain('doc-id-mismatch');
    expect(r.hardFails).toEqual([]);
  });

  it('escalates a legible >2-digit document-ID mismatch to HARD', () => {
    const r = crossCheckIdentity(
      input({ doc: { idNumber: '8502285009087', surname: 'FOURIE', names: 'G', dob: '1980-01-01', legibility: 95 } }),
    );
    expect(r.hardFails).toContain('doc-id-mismatch-legible');
  });

  it('keeps a >2-digit mismatch SOFT when the doc is barely legible', () => {
    const r = crossCheckIdentity(
      input({ doc: { idNumber: '8502285009087', surname: 'FOURIE', names: 'G', dob: '1980-01-01', legibility: 55 } }),
    );
    expect(r.hardFails).toEqual([]);
    expect(r.softFails).toContain('doc-id-mismatch');
  });

  it('SOFT-fails a document DOB mismatch', () => {
    const r = crossCheckIdentity(
      input({ doc: { idNumber: ID, surname: 'FOURIE', names: 'G', dob: '1980-02-01', legibility: 90 } }),
    );
    expect(r.softFails).toContain('doc-dob-mismatch');
  });

  it('surname fuzz: case/spacing/small OCR slips pass', () => {
    for (const s of ['Van der Merwe', 'VAN DER MERWE', 'VANDERMERWE', 'VAN DER MERWL']) {
      const r = crossCheckIdentity(
        input({
          doc: { idNumber: ID, surname: s, names: 'G', dob: '1980-01-01', legibility: 90 },
          ha: { firstName: 'G', surname: 'VAN DER MERWE', dob: '1980-01-01' },
        }),
      );
      expect(r.softFails).not.toContain('doc-surname-ha-mismatch');
    }
  });

  it('surname fuzz: a different surname SOFT-fails', () => {
    const r = crossCheckIdentity(
      input({
        doc: { idNumber: ID, surname: 'SMITH', names: 'G', dob: '1980-01-01', legibility: 90 },
        ha: { firstName: 'G', surname: 'NKOSI', dob: '1980-01-01' },
      }),
    );
    expect(r.softFails).toContain('doc-surname-ha-mismatch');
  });

  it('SOFT-fails an unreadable document (no ID + no DOB extracted)', () => {
    const r = crossCheckIdentity(
      input({ doc: { idNumber: null, surname: null, names: null, dob: null, legibility: 20 } }),
    );
    expect(r.softFails).toContain('doc-unreadable');
    expect(r.hardFails).toEqual([]);
  });
});
