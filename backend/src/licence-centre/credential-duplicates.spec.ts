import { documentFingerprints, duplicateNote, findDuplicate } from './credential-duplicates';

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
