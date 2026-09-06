import { MotivationLicenceType } from '@prisma/client';
import {
  COMPETENCY_RENEWS_KEY,
  factPackFields,
  fieldByKey,
  isVisible,
  requiredKeys,
  sanitiseAnswers,
  SAPS271_DEALER,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
} from '../motivations/motivation-fields';
import {
  competencyCategoriesFrom,
  competencyRenewalNote,
  competencyRenewalSeed,
  RenewalSource,
  REFUSAL_COPY,
  renewalPlan,
  renewalRefusal,
} from './licence-renewal';

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

  it('does NOT refuse just because the licence number is unreadable', () => {
    // It used to, and it was a dead end with no exit: the extraction prompt
    // omits anything it cannot read with certainty, so a glare on the card
    // loses the number while the expiry reads fine — and nothing in the
    // product could then add it. The wizard asks for the number as a
    // required editable field anyway, so the honest move is to open the
    // renewal and let them type the one value we could not read.
    expect(renewalRefusal({ ...base, details: { make: 'Musgrave' } })).toBeNull();
    expect(
      renewalRefusal({ ...base, details: { licence_number: '   ' } }),
    ).toBeNull();
  });

  it('still opens a usable renewal when the number is missing', () => {
    const { seed, applicationRef } = renewalPlan({
      ...base,
      details: { make: 'Musgrave', calibre: '.308 Winchester' },
    });
    expect(seed.existing_licence_number).toBeUndefined();
    expect(seed.firearm_make).toBe('Musgrave');
    expect(seed.licence_expiry).toBe('2027-03-15');
    // No number means no per-licence reference, so a second renewal would
    // collide on the one-per-type constraint. Accepted: the alternative was
    // no renewal at all.
    expect(applicationRef).toBe('');
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

  it('seeds the fields the WIZARD renders, not only the SAPS 271 slots', () => {
    // The card promises "already carrying the firearm's details". The step the
    // applicant actually sees reads firearm_make / firearm_calibre / etc, and
    // every one is required — seeding only existing_firearm_1_* left five
    // blank required boxes under that promise.
    const { seed } = renewalPlan(base);
    expect(seed.firearm_make).toBe('Musgrave');
    expect(seed.firearm_calibre).toBe('.308 Winchester');
    expect(seed.firearm_type).toBe('Rifle');
    expect(seed.firearm_serial).toBe('MG55512');
  });

  it('normalises what is printed on the card onto the registry choices', () => {
    // Transcription is verbatim by design, so a card says "RIFLE" or
    // "Self-loading rifle". sanitiseAnswers drops an unrecognised choice
    // silently, so the seed looked applied and was not.
    const t = (raw: string) =>
      renewalPlan({ ...base, details: { ...base.details, firearm_type: raw } })
        .seed.firearm_type;
    expect(t('RIFLE')).toBe('Rifle');
    expect(t('Self-loading rifle')).toBe('Rifle');
    expect(t('PISTOL')).toBe('Handgun');
    expect(t('Revolver')).toBe('Handgun');
    expect(t('SHOTGUN')).toBe('Shotgun');
    // Unmappable is OMITTED, never guessed — the wizard asks instead.
    expect(t('Musket')).toBeUndefined();
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

// ────────────────────────────────────────────────────────────────────
// SAPS 517(g) — THE SECOND FORM THE PRODUCT NEVER MENTIONED.
//
// A competency has no life of its own: s10(2) as amended ties it to the
// licence it relates to, in practice the LATEST-dated licence in that firearm
// category. So most renewals change nothing about the competency — a
// longer-dated licence in the same category is still holding it up.
//
// But when the licence being renewed is the LAST one in its category, the
// competency expires on the same day, and reference §6.2 is explicit: a 517(g)
// is due, lodged together with the licence renewal (s10A(1)). Miss it and the
// licence renewal can go through while the competency behind it lapses.
//
// Nothing in the Centre said a word about this, on any channel, ever.
// ────────────────────────────────────────────────────────────────────

const EXPIRES = new Date('2027-03-15T00:00:00.000Z');
const later = new Date('2031-01-01T00:00:00.000Z');
const earlier = new Date('2026-01-01T00:00:00.000Z');

describe('whether a SAPS 517(g) is due with this renewal', () => {
  it('says so when this is the LAST licence in its category', () => {
    const note = competencyRenewalNote({
      category: 'handgun',
      expiresOn: EXPIRES,
      otherLicences: [{ category: 'rifle-carbine', expiresOn: later }],
      competencyCategories: ['handgun'],
    });
    expect(note).toMatch(/517\(g\)/);
    expect(note).toMatch(/handgun/);
    // It must say the two go in together — that is the part of s10A(1) a
    // member can act on, and the reason it is worth telling them now rather
    // than after the visit.
    expect(note).toMatch(/lodged together|at the same time/i);
  });

  it('⚠️ says NOTHING when a longer-dated licence still holds it up', () => {
    // The ordinary case, and the reason this cannot be hedged onto every
    // reminder: advice attached to renewals that do not need it trains people
    // to skip the ones that do.
    expect(
      competencyRenewalNote({
        category: 'handgun',
        expiresOn: EXPIRES,
        otherLicences: [{ category: 'handgun', expiresOn: later }],
        competencyCategories: ['handgun'],
      }),
    ).toBeNull();
  });

  it('⚠️ still says so when the other licence expires FIRST', () => {
    // A shorter-dated licence in the same category does not hold a competency
    // up — the competency runs to the LATEST, which is this one.
    expect(
      competencyRenewalNote({
        category: 'handgun',
        expiresOn: EXPIRES,
        otherLicences: [{ category: 'handgun', expiresOn: earlier }],
        competencyCategories: ['handgun'],
      }),
    ).not.toBeNull();
  });

  it('⚠️ still says so when another licence expires on the SAME DAY', () => {
    // Both lapse that day, so the competency lapses with them and the 517(g)
    // is still due. A `>=` test here would have the second licence silently
    // vouch for the first and talk the member out of a form they need.
    expect(
      competencyRenewalNote({
        category: 'handgun',
        expiresOn: EXPIRES,
        otherLicences: [{ category: 'handgun', expiresOn: new Date(EXPIRES) }],
        competencyCategories: ['handgun'],
      }),
    ).not.toBeNull();
  });

  it('says nothing when no competency covers this category', () => {
    // Nothing to renew alongside it.
    expect(
      competencyRenewalNote({
        category: 'shotgun',
        expiresOn: EXPIRES,
        otherLicences: [],
        competencyCategories: ['handgun', 'rifle-carbine'],
      }),
    ).toBeNull();
  });

  it('⚠️ says nothing about a licence we could not categorise', () => {
    // Null is excluded, never defaulted — the same rule the whole derivation
    // runs on. Being silent costs a sentence; being wrong sends somebody to
    // the DFO for a form they do not need, or leaves them without one.
    expect(
      competencyRenewalNote({
        category: null,
        expiresOn: EXPIRES,
        otherLicences: [],
        competencyCategories: ['handgun'],
      }),
    ).toBeNull();
    expect(
      competencyRenewalNote({
        category: 'handgun',
        expiresOn: null,
        otherLicences: [],
        competencyCategories: ['handgun'],
      }),
    ).toBeNull();
  });

  it('⚠️ never offers it for a muzzle loader', () => {
    // A muzzle loader takes no licence at all (s3(2)), so there is no licence
    // renewal to lodge anything alongside — its competency runs its own fixed
    // ten years under s10(3) and renews on its own timetable.
    expect(
      competencyRenewalNote({
        category: 'muzzle-loader',
        expiresOn: EXPIRES,
        otherLicences: [],
        competencyCategories: ['muzzle-loader'],
      }),
    ).toBeNull();
  });
});

describe('reading the categories off stored certificates', () => {
  it('turns a real compound endorsement line into categories', () => {
    // Copied off the operator's own SAPS 524.
    expect(
      competencyCategoriesFrom(['S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN']).sort(),
    ).toEqual(['rifle-carbine', 'shotgun']);
  });

  it('merges several certificates, one per endorsement group', () => {
    expect(
      competencyCategoriesFrom(['HANDGUN', 'MANUALLY OPERATED RIFLE']).sort(),
    ).toEqual(['handgun', 'rifle-carbine']);
  });

  it('⚠️ says nothing for a line it cannot read', () => {
    // Empty is the honest answer, and it means no advice rather than wrong
    // advice — see parseEndorsements, which never guesses.
    expect(competencyCategoriesFrom(['', 'SOMETHING ILLEGIBLE'])).toEqual([]);
  });
});

// ────────────────────
// THE FINDING, CARRIED INTO THE PACK.
//
// competencyRenewalNote was computed and shown in one place: the response to
// the tap that started the renewal. A member who glanced at it and came back
// the next day never saw it again, and the 517(g) is the one piece of renewal
// advice that costs a competency when it is missed. So the finding is seeded
// as an answer the checklist can read on every later visit.
// ────────────────────

describe('seeding the 517(g) finding', () => {
  it('writes a plain yes when the advice stands', () => {
    expect(competencyRenewalSeed('This is the last rifle licence you hold…')).toEqual({
      [COMPETENCY_RENEWS_KEY]: 'Yes',
    });
  });

  it('⚠️ writes NOTHING when there is no advice — not "No"', () => {
    // competencyRenewalNote returns null for two different reasons: no 517(g)
    // is due, AND we could not read enough to say. Writing "No" would turn the
    // second into a reassurance we have not earned, on a document the member
    // signs. Absent stays absent.
    expect(competencyRenewalSeed(null)).toEqual({});
  });

  it('⚠️ seeds a value the registry actually accepts', () => {
    // The seed goes through sanitiseAnswers like anything an applicant types.
    // A `yesno` field admits 'Yes' and 'No' and nothing else, so a lower-case
    // 'yes' here would be dropped in silence with the checklist row never
    // appearing and nothing but a log line to show for it.
    const value = competencyRenewalSeed('advice')[COMPETENCY_RENEWS_KEY];
    const { answers } = sanitiseAnswers(MotivationLicenceType.S24_RENEWAL, {
      [COMPETENCY_RENEWS_KEY]: value,
    });
    expect(answers[COMPETENCY_RENEWS_KEY]).toBe('Yes');
  });

  it('⚠️ is never put in front of the applicant as a question', () => {
    // It is a finding we made from their own documents, not something anybody
    // is asked. isVisible must refuse it whatever has been answered —
    // including when it holds its own value — or a renewal opens with a
    // Yes/No box asking a question we already answered for them.
    const field = fieldByKey(
      MotivationLicenceType.S24_RENEWAL,
      COMPETENCY_RENEWS_KEY,
    )!;
    expect(field).toBeDefined();
    // Every state of the one question that un-hides form-only fields, plus the
    // field holding its own value — the two gates on it contradict each other,
    // so there is no answer anywhere that shows it.
    for (const opt of ['', SAPS271_FILL, SAPS271_DEALER]) {
      expect(isVisible(field, { [SAPS271_OPT_KEY]: opt })).toBe(false);
      expect(
        isVisible(field, {
          [SAPS271_OPT_KEY]: opt,
          [COMPETENCY_RENEWS_KEY]: 'Yes',
        }),
      ).toBe(false);
    }
    // And never demanded before a pack can be generated.
    expect(
      requiredKeys(MotivationLicenceType.S24_RENEWAL, {
        [COMPETENCY_RENEWS_KEY]: 'Yes',
      }),
    ).not.toContain(COMPETENCY_RENEWS_KEY);
  });

  it('⚠️ is never shown to the writer', () => {
    // "The applicant also needs a 517(g)" is an instruction about a second
    // form, not a reason anybody needs a firearm — and a model handed it
    // will find a way to argue from it.
    const keys = factPackFields(MotivationLicenceType.S24_RENEWAL).map(
      (f) => f.key,
    );
    expect(keys).not.toContain(COMPETENCY_RENEWS_KEY);
  });
});
