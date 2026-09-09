import { MotivationLicenceType } from '@prisma/client';
import { documentScope, southAfricanise } from './motivation-scope';
import { arsenalRows } from './motivation-arsenal';

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;

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

// ────────────────────────────────────────────────────────────────────
// MOTIVATION-GUIDE-BOOK PART 8.3 — THE WORDS THAT MAKE A DOCUMENT FAIL.
//
// The book's lists, applied over the whole document. Rule 15 of the system
// prompt has said "banned phrases" since the first draft; before 2026-09-09
// nothing enforced it past the one paragraph validateReason sees, and even
// then only the product-page half.
// ────────────────────────────────────────────────────────────────────
describe('filler, claims and pressure', () => {
  it('⚠️ CATCHES THE CLAIM SAPS ALREADY CHECKS', () => {
    // Items G.62 to G.67 of the SAPS 271 are the declaration and the CFR
    // verifies them. A motivation that asserts a clean record has volunteered
    // an unprovable statement into a document where a false one is an offence.
    const out = documentScope(
      'I have no criminal record and I am a law-abiding citizen.',
      s13,
    );
    expect(out.join(' ')).toContain('no criminal record');
    expect(out.join(' ')).toContain('law-abiding');
  });

  it('catches filler and self-praise', () => {
    const out = documentScope(
      'Furthermore, it is important to note that I am a responsible firearm owner who wants peace of mind.',
      s13,
    );
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it('⚠️ CATCHES PRESSURE AND PREDICTION, including the appeal threat', () => {
    const out = documentScope(
      'I urgently request favourable consideration; failure to grant this would be procedurally unfair.',
      s13,
    );
    const all = out.join(' ');
    expect(all).toContain('favourable consideration');
    expect(all).toContain('procedurally unfair');
  });

  it('⚠️ CATCHES MARKDOWN AND EXCLAMATION MARKS, which print as themselves', () => {
    // The body is set by pdfkit straight from this text.
    expect(documentScope('I need this firearm!', s13).join(' ')).toContain(
      'exclamation mark',
    );
    expect(
      documentScope('My measures are:\n- a wall\n- an alarm', s13).join(' '),
    ).toContain('markdown');
    expect(
      documentScope('This is **important** to me.', s13).join(' '),
    ).toContain('markdown');
  });

  it('leaves an ordinary sentence alone', () => {
    expect(
      documentScope(
        'My shift ends at 22:00 and I drive home alone on the R101; the last four kilometres has no street lighting.',
        s13,
      ),
    ).toEqual([]);
  });
});

describe('the mirror of the section discipline', () => {
  const s16 = {
    licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
    arsenal: arsenalRows(
      {
        existing_firearm_1_make: 'CZ',
        existing_firearm_1_type: 'Handgun',
        existing_firearm_1_calibre: '9mm Luger',
        existing_firearm_1_serial: 'CZ81815',
      },
      { 1: 'section 13' },
    ),
  };

  it('⚠️ REFUSES SELF-DEFENCE WORDS IN A SPORT APPLICATION', () => {
    const out = documentScope(
      'I want this pistol for protection when I travel to matches.',
      s16,
    );
    expect(out.join(' ')).toContain(
      'outside any sentence about a firearm already held under section 13 or 14',
    );
  });

  it('⚠️ ALLOWS THEM WHERE THEY DESCRIBE A LICENCE ALREADY HELD', () => {
    // The exact mirror of the S13 case: this sentence is the one that disposes
    // of the overlap, and a blanket ban would delete it.
    expect(
      documentScope(
        'My CZ 9mm Luger handgun is licensed under section 13 for self-defence; it is a compact carry pistol and a section 13 licence is not issued for sport.',
        s16,
      ),
    ).toEqual([]);
  });

  it('says nothing about defence words on a section 13 application', () => {
    expect(
      documentScope('I need a firearm for self-defence.', s13),
    ).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// SPELLING IS FOLDED, NOT FAILED — MO000074.
//
// The scope check is right that "organization" does not belong in a document
// filed in South African English. But it is a MECHANICAL check, and a
// mechanical failure costs the applicant the whole pack: one regeneration, the
// same two words, then FAILED and an SMS reading "we could not finish document
// MO000074". Two spellings are not a reason to refuse somebody their licence
// application.
// ────────────────────────────────────────────────────────────────────

describe('folding the spelling this document is filed in', () => {
  it('fixes the two words MO000074 died on', () => {
    expect(southAfricanise('the organization I belong to')).toBe(
      'the organisation I belong to',
    );
    expect(southAfricanise('a specialized discipline')).toBe(
      'a specialised discipline',
    );
  });

  it('leaves nothing behind for the check to find', () => {
    const before =
      'I recognize the caliber, utilized meters of defense, and analyzed the program.';
    const after = southAfricanise(before);
    expect(documentScope(after, { licenceType: S13, arsenal: [] })).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/South African English/)]),
    );
  });

  it('keeps the writer’s capitalisation', () => {
    expect(southAfricanise('Organization')).toBe('Organisation');
    expect(southAfricanise('Defense')).toBe('Defence');
  });

  it('⚠️ CHANGES SPELLING AND NOTHING ELSE', () => {
    // The whole reason it is safe to do silently. A sentence with none of
    // these words must come back byte-identical.
    const untouched =
      'I apply under section 13 for a Glock 17 in 9mm Parabellum, serial ZABA01892, for self-defence.';
    expect(southAfricanise(untouched)).toBe(untouched);
  });

  it('⚠️ DOES NOT EAT A WORD THAT MERELY CONTAINS ONE', () => {
    // The four whole-word pairs are bounded; the -ise stems deliberately are
    // not, so every inflection follows. "programme" must not become
    // "programmeme", and a "prize" is not a "prise".
    expect(southAfricanise('the programme')).toBe('the programme');
    expect(southAfricanise('a prize and the size')).toBe('a prize and the size');
    expect(southAfricanise('kilometers')).toBe('kilometres');
  });
});
