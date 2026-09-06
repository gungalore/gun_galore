import { assessAddressProof } from './address-proof';

const today = new Date('2026-09-07T00:00:00Z');
const profile = {
  firstName: 'Gerhard',
  lastName: 'Fourie',
  addrStreet: '12 Loop Street',
  addrSuburb: 'Hatfield',
  addrCity: 'Pretoria',
  addrPostalCode: '0083',
};

describe('assessAddressProof', () => {
  it('passes a recent bill in the member name at the profile address', () => {
    const v = assessAddressProof({
      details: {
        full_name: 'MR G FOURIE',
        residential_address: '12 LOOP STR, HATFIELD, PRETORIA',
        residential_postal_code: '0083',
      },
      issuedOn: '2026-08-20',
      profile,
      identityName: null,
      today,
    });
    expect(v.ok).toBe(true);
    expect(v.attention).toEqual([]);
  });

  it("flags a bill in somebody else's name", () => {
    const v = assessAddressProof({
      details: { full_name: 'MRS A VAN WYK', residential_address: '12 Loop Street Hatfield' },
      issuedOn: '2026-08-20',
      profile,
      identityName: null,
      today,
    });
    expect(v.attention).toEqual(['name-mismatch']);
    expect(v.uncertain).toEqual(['full_name']);
    expect(v.notes[0]).toContain('MRS A VAN WYK');
  });

  it('accepts the surname off the identity document when the profile has none', () => {
    const v = assessAddressProof({
      details: { full_name: 'G FOURIE', residential_address: '12 Loop Street Hatfield' },
      issuedOn: '2026-08-20',
      profile: { ...profile, lastName: null },
      identityName: 'GERHARD FOURIE',
      today,
    });
    expect(v.attention).toEqual([]);
  });

  it('flags an address that is not the one on the profile', () => {
    const v = assessAddressProof({
      details: {
        full_name: 'G FOURIE',
        residential_address: '77 Church Road, Sandton',
        residential_postal_code: '2196',
      },
      issuedOn: '2026-08-20',
      profile,
      identityName: null,
      today,
    });
    expect(v.attention).toEqual(['address-mismatch']);
  });

  it('lets the postal code carry an address the reader spaced differently', () => {
    const v = assessAddressProof({
      details: {
        full_name: 'G FOURIE',
        residential_address: 'Unit 4 The Willows',
        residential_postal_code: '0083',
      },
      issuedOn: '2026-08-20',
      profile,
      identityName: null,
      today,
    });
    expect(v.attention).toEqual([]);
  });

  it('flags a document older than three months, and one with no date at all', () => {
    const base = {
      details: { full_name: 'G FOURIE', residential_address: '12 Loop Street Hatfield' },
      profile,
      identityName: null,
      today,
    };
    expect(assessAddressProof({ ...base, issuedOn: '2026-05-01' }).attention).toEqual(['stale']);
    expect(assessAddressProof({ ...base, issuedOn: null }).attention).toEqual(['date-missing']);
  });

  it('skips the name and address checks when the profile has nothing to compare against', () => {
    const v = assessAddressProof({
      details: { residential_address: '12 Loop Street' },
      issuedOn: '2026-08-20',
      profile: { firstName: null, lastName: null },
      identityName: null,
      today,
    });
    expect(v.attention).toEqual([]);
  });
});
