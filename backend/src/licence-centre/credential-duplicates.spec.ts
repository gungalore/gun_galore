import {
  documentFingerprints,
  duplicateNote,
  findDuplicate,
  looksLikeLicenceNumber,
} from './credential-duplicates';

const day = new Date('2026-09-01T10:00:00Z');
const cand = (over: Partial<Parameters<typeof findDuplicate>[1][number]>) => ({
  id: 'c1',
  title: 'Licence - .30-06',
  createdAt: day,
  kind: 'FIREARM_LICENCE' as const,
  details: {},
  issuedOn: null,
  ...over,
});

describe('documentFingerprints', () => {
  it('names a licence by its printed serials, ignoring NONE', () => {
    const f = documentFingerprints({
      kind: 'FIREARM_LICENCE',
      details: { frame_serial: 'B 477-423', barrel_serial: 'NONE', licence_number: '' },
      issuedOn: null,
    });
    expect(f).toEqual(['frame:B477423']);
  });
  it('names a statement of results by its codes and day when there is no number', () => {
    const f = documentFingerprints({
      kind: 'PROFICIENCY',
      details: { unit_standard: '119649, 119651' },
      issuedOn: '2024-03-02',
    });
    expect(f).toEqual(['sor:119649+119651@2024-03-02']);
  });
  it('names a proof of address by address and date, so a newer bill is a different document', () => {
    const a = documentFingerprints({
      kind: 'ADDRESS_CONFIRMATION',
      details: { residential_address: '12 Loop Street, Pretoria' },
      issuedOn: '2026-08-01',
    });
    const b = documentFingerprints({
      kind: 'ADDRESS_CONFIRMATION',
      details: { residential_address: '12 Loop St Pretoria' },
      issuedOn: '2026-09-01',
    });
    expect(a).toHaveLength(1);
    expect(a).not.toEqual(b);
  });
  it('has nothing to say about a document it could not read', () => {
    expect(documentFingerprints({ kind: 'FIREARM_LICENCE', details: {}, issuedOn: null })).toEqual([]);
  });
});

describe('findDuplicate', () => {
  it('finds the earliest same-kind row sharing a serial, however it was spaced', () => {
    const later = cand({
      id: 'later',
      createdAt: new Date('2026-09-03T00:00:00Z'),
      details: { frame_serial: 'b477423' },
    });
    const first = cand({ id: 'first', details: { frame_serial: 'B477-423' } });
    const hit = findDuplicate(
      { kind: 'FIREARM_LICENCE', details: { frame_serial: 'B 477 423' }, issuedOn: null },
      [later, first],
    );
    expect(hit?.id).toBe('first');
  });
  it('never matches across kinds', () => {
    const other = cand({ kind: 'COMPETENCY_CERTIFICATE', details: { competency_number: 'B477423' } });
    expect(
      findDuplicate({ kind: 'FIREARM_LICENCE', details: { frame_serial: 'B477423' }, issuedOn: null }, [other]),
    ).toBeNull();
  });
  it('does not call two licences with no readable serial copies of each other', () => {
    const blank = cand({ details: { frame_serial: 'NONE' } });
    expect(
      findDuplicate({ kind: 'FIREARM_LICENCE', details: { frame_serial: 'NONE' }, issuedOn: null }, [blank]),
    ).toBeNull();
  });
  it('writes the note with the original title and day', () => {
    expect(duplicateNote({ title: 'Licence - .30-06', createdAt: day })).toContain(
      '"Licence - .30-06", which you added on 2026-09-01',
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// WHAT THE OPERATOR'S OWN VAULT HELD ON 2026-09-09.
//
// Seven firearm licence cards, six firearms, and FIVE flagged as duplicates.
// The reader had put the holder's 13-digit ID number into `licence_number` on
// three cards and a bare four-digit number on the other four — the same value
// every time — so a Nordiske .223, a Glock 9mm, a Mauser .30-06 and a Howa
// 6.5 Creedmoor were each called a copy of an unrelated CZ or Marlin.
//
// ⚠️ A DUPLICATE FLAG IS WHERE A BAD READ IS LOUD. It tells a member their
// licences are copies of each other, on the screen where they check them.
// ────────────────────────────────────────────────────────────────────

const licence = (details: Record<string, string>) => ({
  kind: 'FIREARM_LICENCE' as const,
  details,
  issuedOn: null,
});

describe('a licence number that cannot be one', () => {
  it('⚠️ IGNORES A 13-DIGIT ID NUMBER, so one person is not one firearm', () => {
    expect(looksLikeLicenceNumber('8001015009087')).toBe(false);
    const f = documentFingerprints(
      licence({ licence_number: '8001015009087', frame_serial: 'AB1234' }),
    );
    expect(f).toEqual(['frame:AB1234']);
  });

  it('⚠️ IGNORES A BARE YEAR, which four of the cards carried', () => {
    expect(looksLikeLicenceNumber('2035')).toBe(false);
    expect(documentFingerprints(licence({ licence_number: '2035' }))).toEqual(
      [],
    );
  });

  it('keeps a real one', () => {
    expect(looksLikeLicenceNumber('SAPS/2019/0004471')).toBe(true);
    expect(
      documentFingerprints(licence({ licence_number: 'SAPS/2019/0004471' })),
    ).toEqual(['licence:SAPS20190004471']);
  });

  it('⚠️ READS THE RECEIVER SERIAL, which nothing was reading', () => {
    // The operator's Marlin prints NONE for the frame and NONE for the barrel
    // and carries its number on the receiver.
    const f = documentFingerprints(
      licence({
        frame_serial: 'NONE',
        barrel_serial: 'NONE',
        receiver_serial: 'MR90189D',
      }),
    );
    expect(f).toEqual(['receiver:MR90189D']);
  });

  it('⚠️ TWO DIFFERENT FIREARMS ARE NOT A DUPLICATE PAIR', () => {
    // The whole failure in one assertion: same bad licence_number, different
    // serials, and they must not match.
    const day = new Date('2026-09-09T10:00:00Z');
    const cz = {
      id: 'cz',
      title: 'CZ 6.35',
      createdAt: day,
      ...licence({ licence_number: '2035', barrel_serial: '12345' }),
    };
    const glock = licence({ licence_number: '2035', frame_serial: 'ABCD12345' });
    expect(findDuplicate(glock, [cz])).toBeNull();
  });

  it('still catches the same card scanned twice', () => {
    const day = new Date('2026-09-09T10:00:00Z');
    const first = {
      id: 'a',
      title: 'CZ 6.35',
      createdAt: day,
      ...licence({ licence_number: '2035', barrel_serial: '12345' }),
    };
    const again = licence({ licence_number: '2035', barrel_serial: '12345' });
    expect(findDuplicate(again, [first])?.id).toBe('a');
  });
});
