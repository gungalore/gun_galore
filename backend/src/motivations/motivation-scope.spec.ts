import { MotivationLicenceType } from '@prisma/client';
import { documentScope } from './motivation-scope';
import { arsenalRows } from './motivation-arsenal';

// ────────────────────────────────────────────────────────────────────
// WHAT MO000071 SHIPPED.
//
// Every string in this file is quoted from the first pack the rebuilt Licence
// Centre produced. It passed structure, sameness, mechanical verification and
// a model quality gate with a score of 94, and it went out with two invented
// licence sections, five invented roles and 150 words of catalogue copy in a
// self-defence application.
// ────────────────────────────────────────────────────────────────────

const held = arsenalRows(
  {
    existing_firearm_1_make: 'Marlin',
    existing_firearm_1_type: 'Rifle',
    existing_firearm_1_calibre: '.45-70 Government',
    existing_firearm_1_serial: 'MR45701',
    existing_firearm_2_make: 'Howa',
    existing_firearm_2_type: 'Rifle',
    existing_firearm_2_calibre: '6.5mm Creedmoor',
    existing_firearm_2_serial: 'HW65001',
  },
  { 1: 'section 16', 2: 'section 15' },
);

const s13 = {
  licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
  arsenal: held,
};

describe('the sections a document may name', () => {
  it('⚠️ CATCHES THE MARLIN, which shipped under the wrong section', () => {
    const out = documentScope(
      'I hold a MARLIN rifle in .45-70 Government under section 15.',
      s13,
    );
    expect(out.join(' ')).toContain('the licence card says section 16');
  });

  it('accepts the section the card actually carries', () => {
    const out = documentScope(
      'I hold a MARLIN rifle in .45-70 Government under section 16, which may not be used for self-defence.',
      s13,
    );
    expect(out.filter((i) => i.includes('section'))).toEqual([]);
  });

  it('⚠️ REFUSES A SECTION FOR A FIREARM NO CARD PLACED', () => {
    // A guess that is right by chance is still a guess.
    const loose = {
      ...s13,
      arsenal: arsenalRows({
        existing_firearm_1_make: 'Marlin',
        existing_firearm_1_calibre: '.45-70 Government',
        existing_firearm_1_serial: 'MR45701',
      }),
    };
    const out = documentScope(
      'My Marlin in .45-70 Government is held under section 16.',
      loose,
    );
    expect(out.join(' ')).toContain('no licence card established a section');
  });

  it('leaves the applied-for section alone', () => {
    // "I apply under section 13" names no held firearm and must pass.
    const out = documentScope(
      'I apply for a licence in terms of section 13 of the Firearms Control Act.',
      s13,
    );
    expect(out).toEqual([]);
  });
});

describe('the roles a document may state', () => {
  it('⚠️ CATCHES A PURPOSE NOTHING SUPPLIED', () => {
    const out = documentScope(
      'The Howa in 6.5mm Creedmoor is a dedicated precision sport shooting rifle under section 15.',
      s13,
    );
    expect(out.join(' ')).toContain('nothing in the pack states what it is licensed for');
  });

  it('accepts a purpose the endorsement supplied', () => {
    const stated = {
      ...s13,
      arsenal: arsenalRows(
        {
          existing_firearm_1_make: 'Howa',
          existing_firearm_1_calibre: '6.5mm Creedmoor',
          existing_firearm_1_serial: 'HW65001',
          existing_firearm_1_use: 'plains game hunting',
        },
        { 1: 'section 15' },
      ),
    };
    const out = documentScope(
      'My Howa in 6.5mm Creedmoor is licensed under section 15 for plains game hunting.',
      stated,
    );
    expect(out).toEqual([]);
  });
});

describe('the register of the whole document', () => {
  it('⚠️ CATCHES THE PHRASES A REGISTRAR READS AGAINST THE APPLICANT', () => {
    const out = documentScope(
      'The pistol offers high magazine capacities and proven terminal ballistics.',
      s13,
    );
    const all = out.join(' ');
    expect(all).toContain('magazine capacit');
    expect(all).toContain('terminal ballistic');
  });

  it('catches the product copy that shipped in section 4', () => {
    const out = documentScope(
      'A short-recoil, tilting barrel action in a polymer frame with a Safe Action trigger tolerates dust, lint and variable maintenance cycles.',
      s13,
    );
    expect(out.length).toBeGreaterThan(2);
  });

  it('⚠️ REPORTS EACH PHRASE ONCE, so one word cannot bury four faults', () => {
    const out = documentScope(
      'This platform is a proven platform. The platform is reliable.',
      s13,
    );
    expect(out.filter((i) => i.includes('"platform"'))).toHaveLength(1);
  });

  it('still catches Americanisms outside the reason paragraph', () => {
    const out = documentScope(
      'The firearm is authorized in that caliber for use at fifty meters.',
      s13,
    );
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe('what belongs in a self-defence application', () => {
  it('⚠️ ALLOWS HUNTING WHERE IT DESCRIBES A LICENCE ALREADY HELD', () => {
    // This is the strongest paragraph an S13 has, and a blanket word ban would
    // delete it: a section 16 firearm may not be used for self-defence, and
    // saying so means saying what it IS for.
    const stated = {
      ...s13,
      arsenal: arsenalRows(
        {
          existing_firearm_1_make: 'Marlin',
          existing_firearm_1_calibre: '.45-70 Government',
          existing_firearm_1_serial: 'MR45701',
          existing_firearm_1_use: 'hunting',
        },
        { 1: 'section 16' },
      ),
    };
    expect(
      documentScope(
        'My Marlin in .45-70 Government is licensed under section 16 for hunting, and a section 16 firearm may not be carried for self-defence.',
        stated,
      ),
    ).toEqual([]);
  });

  it('refuses hunting anywhere else in an S13', () => {
    const out = documentScope(
      'I intend to use the firearm for hunting at weekends.',
      s13,
    );
    expect(out.join(' ')).toContain('outside any sentence about a firearm already held');
  });

  it('⚠️ REFUSES RELOADING OUTRIGHT ON AN S13', () => {
    // It reached MO000071 as "experience" because the profile row is asked on
    // every licence type.
    const out = documentScope(
      'I have been reloading my own ammunition since 2019.',
      s13,
    );
    expect(out.join(' ')).toContain('discusses "reload"');
  });

  it('says nothing about sport on a section 16 application', () => {
    const s16 = {
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
      arsenal: [],
    };
    expect(
      documentScope('I compete in sport shooting most weekends.', s16),
    ).toEqual([]);
  });
});

describe('what the document may say about a competency', () => {
  it('⚠️ REFUSES A VALIDITY DATE, because a competency prints none', () => {
    // MO000071: "competency certificate C9882094 ... remains valid until
    // 2026-08-26", in a document dated 9 September 2026. Any such date is
    // DERIVED from something else, and this one was derived wrongly.
    const out = documentScope(
      'My competency certificate C9882094 remains valid until 2026-08-26.',
      s13,
    );
    expect(out.join(' ')).toContain('prints no expiry');
  });

  it('leaves the certificate number and a plain claim of validity alone', () => {
    expect(
      documentScope(
        'I hold competency certificate C9882094, which is valid and annexed.',
        s13,
      ),
    ).toEqual([]);
  });

  it('does not trip on a LICENCE expiry, which is printed and is a fact', () => {
    expect(
      documentScope('My licence for that rifle expires on 28 October 2034.', s13),
    ).toEqual([]);
  });
});
