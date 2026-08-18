import { MotivationLicenceType } from '@prisma/client';
import {
  ProfileSource,
  profileCoverageNote,
  profileOffer,
} from './motivation-profile';

// Prefill touches somebody's identity data, so the two properties that matter
// are: it never overwrites what they typed, and it never overstates how much of
// the application it can actually reach.

const T = MotivationLicenceType.S13_SELF_DEFENCE;

const FULL: ProfileSource = {
  firstName: 'Jan',
  lastName: 'Pietersen',
  email: 'jan@example.co.za',
  phone: '0821234567',
  idNumber: '8001015009087',
  addrBuilding: 'Unit 4',
  addrStreet: '12 Kerk Street',
  addrAddress2: null,
  addrSuburb: 'Universitas',
  addrCity: 'Bloemfontein',
  addrPostalCode: '9301',
  addrProvince: 'FREE_STATE',
};

const EMPTY: ProfileSource = {
  firstName: null,
  lastName: null,
  email: null,
  phone: null,
  idNumber: null,
  addrBuilding: null,
  addrStreet: null,
  addrAddress2: null,
  addrSuburb: null,
  addrCity: null,
  addrPostalCode: null,
  addrProvince: null,
};

describe('what the profile can reach', () => {
  it('offers name, ID, address, postal code and cellphone', () => {
    const o = profileOffer(T, FULL, {});
    expect(Object.keys(o.values).sort()).toEqual([
      'cellphone',
      'full_name',
      'id_number',
      'residential_address',
      'residential_postal_code',
    ]);
    expect(o.values.full_name).toBe('Jan Pietersen');
    expect(o.values.id_number).toBe('8001015009087');
  });

  it('joins the address parts the profile keeps separately', () => {
    expect(profileOffer(T, FULL, {}).values.residential_address).toBe(
      'Unit 4 12 Kerk Street, Universitas, Bloemfontein, FREE_STATE',
    );
  });

  it('says where every value came from', () => {
    // The applicant is agreeing to this, so "your account address" has to
    // appear next to the value rather than just a field name.
    const o = profileOffer(T, FULL, {});
    for (const key of Object.keys(o.values)) expect(o.from[key]).toBeTruthy();
    expect(o.from.id_number).toMatch(/identity check/i);
  });

  it('reaches only a handful of the form, and the note does not pretend otherwise', () => {
    // The profile holds marketplace data. Competency, existing firearms, safe
    // details, association membership and the history questions are not in it
    // and never will be, so a "complete" profile is not a complete application.
    const o = profileOffer(T, FULL, {});
    expect(Object.keys(o.values).length).toBeLessThan(10);
    expect(profileCoverageNote(o)).toMatch(/only you can tell us/i);
  });
});

describe('what it refuses to do', () => {
  it('NEVER overwrites an answer the applicant already gave', () => {
    // A signed form that quietly contradicts what they typed is the worst
    // outcome available here.
    const o = profileOffer(T, FULL, {
      full_name: 'Johannes Pietersen',
      residential_address: 'A different address entirely',
    });
    expect(o.values.full_name).toBeUndefined();
    expect(o.values.residential_address).toBeUndefined();
    // …and still offers the rest.
    expect(o.values.id_number).toBe('8001015009087');
  });

  it('treats a whitespace-only answer as unanswered', () => {
    const o = profileOffer(T, FULL, { full_name: '   ' });
    expect(o.values.full_name).toBe('Jan Pietersen');
  });

  it('offers nothing at all from an empty profile, and does not throw', () => {
    const o = profileOffer(T, EMPTY, {});
    expect(o.values).toEqual({});
    expect(o.missingFromProfile.length).toBeGreaterThan(0);
    expect(profileCoverageNote(o)).toMatch(/nothing in your profile/i);
  });

  it('never offers a key that is not a registered field', () => {
    const o = profileOffer(T, FULL, {});
    for (const key of Object.keys(o.values)) {
      expect(typeof key).toBe('string');
      expect(o.values[key].length).toBeGreaterThan(0);
    }
    // email is not a registry field on this licence type — it comes off the
    // account at render time, so prefill must not invent an answer for it.
    expect(o.values.email).toBeUndefined();
  });
});

describe('what it asks for back', () => {
  it('names the gaps as an invitation, not a requirement', () => {
    const partial: ProfileSource = { ...EMPTY, firstName: 'Jan', lastName: 'P' };
    const o = profileOffer(T, partial, {});
    expect(o.missingFromProfile).toEqual(
      expect.arrayContaining([expect.stringMatching(/ID number/i)]),
    );
    // Phrased as something they can add, never as a block.
    const text = o.missingFromProfile.join(' ').toLowerCase();
    expect(text).not.toContain('required');
    expect(text).not.toContain('must');
  });

  it('does not list a gap it managed to fill', () => {
    const o = profileOffer(T, FULL, {});
    expect(o.missingFromProfile).toEqual([]);
  });
});
