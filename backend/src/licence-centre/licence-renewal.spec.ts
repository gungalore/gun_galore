import { RenewalSource, REFUSAL_COPY, renewalPlan, renewalRefusal } from './licence-renewal';

// The renewal one-tap is the loop the Licence Centre exists for: the reminder
// lands and turns into a section 24 pack that already knows the licence. Two
// ways it can go wrong — it offers itself where it makes no sense, or it puts
// words in an applicant's mouth on a document they sign as their own.

const base: RenewalSource = {
  kind: 'FIREARM_LICENCE',
  title: 'My .308',
  expiresOn: new Date('2027-03-15T00:00:00.000Z'),
  confirmedAt: new Date('2026-08-19T00:00:00.000Z'),
  details: {
    licence_number: 'ZA1234567',
    make: 'Musgrave',
    calibre: '.308 Winchester',
    firearm_type: 'Rifle',
    frame_serial: 'MG55512',
    barrel_serial: 'BR99001',
  },
};

describe('when a renewal cannot start', () => {
  it('refuses anything that is not a firearm licence', () => {
    // Competency and dedicated status renew through different processes. A
    // section 24 pack for one of those is a document for the wrong thing.
    for (const kind of [
      'COMPETENCY_CERTIFICATE',
      'DEDICATED_STATUS',
      'PROFICIENCY',
      'OTHER',
    ] as const) {
      expect(renewalRefusal({ ...base, kind })).toBe('not-a-licence');
    }
  });

  it('refuses a date nobody has confirmed', () => {
    // The expiry IS the application. An unconfirmed date is one we read off a
    // photograph and nobody checked.
    expect(renewalRefusal({ ...base, confirmedAt: null })).toBe(
      'no-confirmed-date',
    );
    expect(renewalRefusal({ ...base, expiresOn: null })).toBe(
      'no-confirmed-date',
    );
  });

  it('refuses when the licence number could not be read', () => {
    expect(renewalRefusal({ ...base, details: { make: 'Musgrave' } })).toBe(
      'no-licence-number',
    );
    expect(
      renewalRefusal({ ...base, details: { licence_number: '   ' } }),
    ).toBe('no-licence-number');
  });

  it('allows a real one', () => {
    expect(renewalRefusal(base)).toBeNull();
  });

  it('explains every refusal in terms of what to do next', () => {
    for (const [key, copy] of Object.entries(REFUSAL_COPY)) {
      expect(copy.length).toBeGreaterThan(30);
      // ⚖️ No outcome language anywhere in this module.
      for (const banned of ['approv', 'guarantee', 'chance', 'success']) {
        expect(copy.toLowerCase()).not.toContain(banned);
      }
      expect(key).toBeTruthy();
    }
  });
});

describe('what the renewal opens with', () => {
  it('carries the licence number and the expiry', () => {
    const { seed } = renewalPlan(base);
    expect(seed.existing_licence_number).toBe('ZA1234567');
    expect(seed.licence_expiry).toBe('2027-03-15');
  });

  it('carries the firearm itself, on the keys the rest of the registry uses', () => {
    const { seed } = renewalPlan(base);
    expect(seed.existing_firearm_1_make).toBe('Musgrave');
    expect(seed.existing_firearm_1_calibre).toBe('.308 Winchester');
    expect(seed.existing_firearm_1_type).toBe('Rifle');
    expect(seed.existing_firearm_1_frame_serial).toBe('MG55512');
    expect(seed.existing_firearm_1_barrel_serial).toBe('BR99001');
    expect(seed.existing_firearm_1_licence_no).toBe('ZA1234567');
  });

  it('LEAVES THE ARGUMENT EMPTY', () => {
    // `continued_use` — what they have actually done with the firearm since it
    // was issued — is the only part of a renewal that argues anything, and it
    // is why the pack is worth paying for. Pre-filling it would put words in
    // an applicant's mouth on a document they sign as their own.
    const { seed } = renewalPlan(base);
    expect(seed.continued_use).toBeUndefined();
  });

  it('never invents a value the document did not carry', () => {
    const { seed } = renewalPlan({
      ...base,
      details: { licence_number: 'ZA1234567' },
    });
    expect(seed.existing_firearm_1_make).toBeUndefined();
    expect(seed.existing_firearm_1_calibre).toBeUndefined();
    // …and still carries what it does have.
    expect(seed.existing_licence_number).toBe('ZA1234567');
  });

  it('drops whitespace-only values rather than seeding a blank', () => {
    const { seed } = renewalPlan({
      ...base,
      details: { ...base.details, make: '   ' },
    });
    expect(seed.existing_firearm_1_make).toBeUndefined();
  });
});

describe('renewing more than one licence', () => {
  it('gives each renewal its own reference, keyed on the licence', () => {
    // THE CONSTRAINT THIS EXISTS FOR: @@unique([userId, licenceType,
    // applicationRef]). With a fixed ref, a member could renew exactly one
    // firearm, ever — the second attempt would collide and read as "you
    // already have a renewal in progress".
    const a = renewalPlan(base);
    const b = renewalPlan({
      ...base,
      details: { ...base.details, licence_number: 'ZA7654321' },
    });
    expect(a.applicationRef).toBe('LIC-ZA1234567');
    expect(b.applicationRef).toBe('LIC-ZA7654321');
    expect(a.applicationRef).not.toBe(b.applicationRef);
  });

  it('is stable, so renewing the same licence twice collides on purpose', () => {
    // Deliberate: a second renewal of the SAME licence should hit the
    // one-in-progress guard rather than quietly making a duplicate pack.
    expect(renewalPlan(base).applicationRef).toBe(
      renewalPlan({ ...base }).applicationRef,
    );
  });
});
