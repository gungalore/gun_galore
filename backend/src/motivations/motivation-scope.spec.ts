import { MotivationStatus } from '@prisma/client';
import { REGENERABLE } from './motivation-generation.service';
import { MotivationLicenceType } from '@prisma/client';
import {
  documentScope,
  southAfricanise,
  withoutRefusedCopy,
} from './motivation-scope';
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

  /**
   * ⚠️ THE OPERATOR'S OVERRIDE OF GUIDE-BOOK PART 1 RULE 7, 2026-09-09.
   * Candidate uses are generated per firearm CLASS and attached to the row, so
   * a row carrying them DOES have something behind the sentence. See
   * firearm-uses.service.ts for the reasoning and for what stays refused.
   */
  it('accepts a purpose the generated uses supplied', () => {
    const generated = {
      ...s13,
      arsenal: arsenalRows(
        {
          existing_firearm_1_make: 'Howa',
          existing_firearm_1_calibre: '6.5mm Creedmoor',
          existing_firearm_1_serial: 'HW65001',
        },
        { 1: 'section 15' },
        {
          1: [
            {
              label: 'occasional hunting',
              uses: ['I use it for plains game at moderate ranges.'],
            },
          ],
        },
      ),
    };
    const out = documentScope(
      'My Howa in 6.5mm Creedmoor is licensed under section 15 and I use it for plains game hunting.',
      generated,
    );
    expect(out).toEqual([]);
  });

  it('⚠️ STILL REFUSES A ROW THAT GOT NO USES EITHER', () => {
    // A model outage returns [], and then there really is nothing in the pack
    // behind the sentence. `forClass` fails soft precisely so this stays true.
    const none = {
      ...s13,
      arsenal: arsenalRows(
        {
          existing_firearm_1_make: 'Howa',
          existing_firearm_1_calibre: '6.5mm Creedmoor',
          existing_firearm_1_serial: 'HW65001',
        },
        { 1: 'section 15' },
        { 1: [] },
      ),
    };
    const out = documentScope(
      'My Howa in 6.5mm Creedmoor is licensed under section 15 and I use it for plains game hunting.',
      none,
    );
    expect(out.join(' ')).toContain(
      'nothing in the pack states what it is licensed for',
    );
  });

  it('⚠️ DOES NOT RELAX THE SECTION, WHICH IS A DIFFERENT KIND OF CLAIM', () => {
    // A section is checkable against a card in the same pack; a use is not.
    const generated = {
      ...s13,
      arsenal: arsenalRows(
        {
          existing_firearm_1_make: 'Marlin',
          existing_firearm_1_calibre: '.45-70 Government',
          existing_firearm_1_serial: 'MR45701',
        },
        { 1: 'section 16' },
        {
          1: [
            {
              label: 'dedicated hunting',
              uses: ['I use it for large plains game at close range.'],
            },
          ],
        },
      ),
    };
    const out = documentScope(
      'I hold a MARLIN rifle in .45-70 Government under section 15.',
      generated,
    );
    expect(out.join(' ')).toContain('the licence card says section 16');
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

  /**
   * ⚠️ THE OPERATOR'S CARVE-OUT, 2026-09-09. Their example sentence: "the
   * .300winmag is suited for giraffe hunting so the .300prc will do the same
   * but I will have the same stopping power and accuracy at further ranges."
   * I flagged that "stopping power" was on the refuse list; they chose to
   * allow it in the comparison and nowhere else.
   */
  it('allows a capability term where the document is COMPARING', () => {
    const out = documentScope(
      'The Howa in 6.5mm Creedmoor cannot deliver the same terminal ballistics at those distances.',
      s13,
    );
    expect(out.join(' ')).not.toContain('terminal ballistic');
  });

  it('⚠️ STILL REFUSES IT WHERE THE DOCUMENT IS MERELY ADMIRING', () => {
    // Naming a firearm is not comparing. This is a product page.
    const out = documentScope(
      'The Howa in 6.5mm Creedmoor offers proven terminal ballistics.',
      s13,
    );
    expect(out.join(' ')).toContain('terminal ballistic');
  });

  it('⚠️ AND REFUSES IT WHERE NO FIREARM IS NAMED AT ALL', () => {
    // A loose sentence about cartridges in general is not a comparison.
    const out = documentScope(
      'A larger cartridge does not offer the same stopping power.',
      s13,
    );
    expect(out.join(' ')).toContain('stopping power');
  });

  it('⚠️ MAGAZINE CAPACITY STAYS FATAL EVEN INSIDE A COMPARISON', () => {
    // CLAUDE.md names it as a phrase a Registrar reads against the applicant,
    // and it is never an argument for a licence.
    const out = documentScope(
      'The Howa in 6.5mm Creedmoor cannot match the magazine capacity I need.',
      s13,
    );
    expect(out.join(' ')).toContain('magazine capacit');
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

// ────────────────────────────────────────────────────────────────────
// A FAILED DOCUMENT CAN BE TRIED AGAIN, BECAUSE WE TOLD THEM IT COULD.
//
// notifyOutcome sends: "we could not finish document MO000074. Nothing is lost
// and nothing was charged. Open it and try again" — with a link. Until
// 2026-09-09 FAILED was excluded from REGENERABLE on the reasoning that "an
// admin owns those", so the member opened it, pressed the enabled button, and
// got 409 "This document cannot be prepared again from here. Contact support."
// Measured on MO000074 through the real page.
//
// A FAILED row is our own writer failing its own mechanical checks twice.
// There is nothing for an admin to adjudicate, and the applicant is the one
// person who cannot fix it.
// ────────────────────────────────────────────────────────────────────

describe('what a member may ask to be written again', () => {
  it('⚠️ INCLUDES FAILED, WHICH IS WHAT THE SMS PROMISES', () => {
    expect(REGENERABLE).toContain(MotivationStatus.FAILED);
  });

  it('still refuses a run that is in flight', () => {
    // Two clicks must not both call the model — that is duplicated spend and a
    // race on the row.
    expect(REGENERABLE).not.toContain(MotivationStatus.GENERATING);
    expect(REGENERABLE).not.toContain(MotivationStatus.QUALITY_REVIEW);
  });

  it('⚠️ STILL REFUSES ABANDONED — that is somebody walking away', () => {
    expect(REGENERABLE).not.toContain(MotivationStatus.ABANDONED);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE SUBJECT CARRIES ACROSS SENTENCES.
//
// Heading 6 is "Firearms already licensed to me", and the book asks for one
// sentence per firearm on why it cannot do this job. Nobody writes that by
// repeating the make every time. Read off MO000074 on 2026-09-09 — three
// refusals, every one a sentence in heading 6 doing exactly what heading 6 is
// for:
//
//   "It is a centrefire rifle designed for specific shooting disciplines, and
//    its physical form factor means it cannot be carried on my person."
// ────────────────────────────────────────────────────────────────────

describe('sport vocabulary in a section 13 battery paragraph', () => {
  const ARSENAL = [
    { make: 'Howa', model: '1500', type: 'Rifle', calibre: '6.5mm Creedmoor' },
  ] as never;
  const scope = (text: string) =>
    documentScope(text, { licenceType: S13, arsenal: ARSENAL });
  const sportIssues = (text: string) =>
    scope(text).filter((i) => /outside any sentence about a firearm/.test(i));

  it('⚠️ ALLOWS A PRONOUN THAT FOLLOWS THE FIREARM IT NAMES', () => {
    expect(
      sportIssues(
        'My Howa 1500 in 6.5mm Creedmoor is licensed under section 16. ' +
          'It is a centrefire rifle designed for specific shooting disciplines, ' +
          'and it cannot be carried on my person.',
      ),
    ).toEqual([]);
  });

  it('⚠️ STILL REFUSES A PARAGRAPH THAT NAMES NOTHING HELD', () => {
    // The rule keeps its teeth. A section 13 that wanders into sport with no
    // held firearm in sight is the thing it exists to catch.
    expect(
      sportIssues('I enjoy competitive sport shooting at my local range.'),
    ).not.toEqual([]);
  });

  it('⚠️ RESETS AT THE BLANK LINE', () => {
    // A paragraph about the Howa must not license the next paragraph to talk
    // about hunting.
    expect(
      sportIssues(
        'My Howa 1500 in 6.5mm Creedmoor is licensed under section 16.\n\n' +
          'I hunt plains game most winters.',
      ),
    ).not.toEqual([]);
  });

  it('a bare section reference is enough to open the paragraph', () => {
    // "licensed under section 16 for hunting" is the book's own sentence.
    expect(
      sportIssues(
        'The rifle is licensed under section 16. It is used for hunting and ' +
          'cannot be carried for defence.',
      ),
    ).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE WORD THAT COST A WHOLE MOTIVATION.
//
// MO000074, 2026-09-09: a complete 1 432-word section 13 document refused, and
// the applicant told "we could not finish document MO000074", because one
// sentence began "Furthermore,". Deleting the word costs the sentence nothing.
// ────────────────────────────────────────────────────────────────────

describe('filler that can be deleted, and claims that cannot', () => {
  it('⚠️ DROPS THE WORD THAT FAILED MO000074, AND RECAPITALISES', () => {
    expect(
      southAfricanise(
        'I leave before five. Furthermore, my daily commute takes me through ' +
          'high-risk precincts.',
      ),
    ).toBe(
      'I leave before five. My daily commute takes me through high-risk precincts.',
    );
  });

  it('drops it at the very start of the document too', () => {
    expect(southAfricanise('Moreover, the street has no guard.')).toBe(
      'The street has no guard.',
    );
  });

  it('leaves nothing behind for the check to find', () => {
    const after = southAfricanise('I work late. In conclusion, I need this.');
    expect(
      documentScope(after, { licenceType: S13, arsenal: [] }).filter((i) =>
        /filler/.test(i),
      ),
    ).toEqual([]);
  });

  it('⚠️ NEVER TOUCHES A CLAIM — those must still fail', () => {
    // Cut "peace of mind" or "law-abiding" and the sentence means something
    // else, or nothing. A document making them should not be filed.
    for (const claim of [
      'I want a firearm for peace of mind.',
      'I am a law-abiding citizen.',
      'I keep it in case something happens.',
    ]) {
      expect(southAfricanise(claim)).toBe(claim);
      expect(
        documentScope(claim, { licenceType: S13, arsenal: [] }).length,
      ).toBeGreaterThan(0);
    }
  });

  it('⚠️ SENTENCE-INITIAL ONLY — mid-sentence it may be a fact', () => {
    // A night-shift worker's routine genuinely happens at the end of the day.
    const s = 'I return home at the end of the day, often after eleven.';
    expect(southAfricanise(s)).toBe(s);
  });
});

// ────────────────────────────────────────────────────────────────────
// HEADING 6 IS A PARAGRAPH ABOUT ONE FIREARM, NOT A ROW OF SENTENCES.
//
// MO000075, 2026-09-10, refused for: the document says "terminal ballistic"
// outside any sentence comparing this firearm with one already held.
// ────────────────────────────────────────────────────────────────────

describe('⚠️ the capability carve-out reads the paragraph', () => {
  const arsenal = [
    {
      make: 'MARLIN',
      model: '1895',
      calibre: '.45-70 Government',
      serial: 'MR90189D',
      section: 'section 16',
    },
  ] as never;

  const scope = (body: string) =>
    documentScope(body, {
      licenceType: 'S16_DEDICATED_SPORT' as never,
      arsenal,
    });

  it('⚠️ ACCEPTS A PRONOUN CARRYING THE PARAGRAPH SUBJECT', () => {
    // Nobody writes heading 6 by repeating the make in every sentence. They
    // name it, then say "It ...". The rule read only the sentence, so the
    // second one looked like catalogue copy about nothing.
    const body = [
      '6. Firearms already licensed to me',
      'The MARLIN .45-70 GOVERNMENT rifle is licensed under section 16. ' +
        'It is chambered for a heavy-bore cartridge, but its terminal ' +
        'ballistics and trajectory prevent it from achieving the precision ' +
        'required for long-range sport shooting.',
    ].join(String.fromCharCode(10) + String.fromCharCode(10));
    expect(scope(body).filter((i) => i.includes('terminal ballistic'))).toEqual(
      [],
    );
  });

  it('⚠️ AND "prevent" COUNTS AS COMPARING, which it did not', () => {
    // The list was all negated auxiliaries - cannot, does not, is not. A
    // shortfall stated as a verb read as no comparison at all.
    // One paragraph: the blank line is where the subject resets, and these
    // two sentences are about the same firearm.
    const body =
      'The MARLIN .45-70 GOVERNMENT rifle is licensed under section 16. ' +
      'Its terminal ballistics prevent it from reaching those distances.';
    expect(scope(body).filter((i) => i.includes('terminal ballistic'))).toEqual(
      [],
    );
  });

  it('still refuses it in a paragraph that names no held firearm', () => {
    // The teeth are unchanged: loose admiration of a cartridge is still a
    // product page, however it is phrased.
    const body = 'The cartridge cannot be beaten for terminal ballistics.';
    expect(
      scope(body).filter((i) => i.includes('terminal ballistic')).length,
    ).toBe(1);
  });
});

describe('⚠️ the research is held to the same standard as the document', () => {
  it('drops a sentence the writer would be refused for repeating', () => {
    // MO000075 was refused three times on "platform", and the sentence came
    // almost word for word out of its own firearm research: a grounded search
    // for a rifle MODEL returns the manufacturer's marketing.
    const payload = [
      'The firearm is built on the Howa 1500 platform, made in Japan.',
      'It is widely used in South African precision rifle events.',
    ].join(' ');
    const out = withoutRefusedCopy(payload);
    expect(out).not.toMatch(/platform/i);
    expect(out).toMatch(/precision rifle events/);
  });

  it('⚠️ AND THE PARTS LIST, which the brief forbids and nothing enforced', () => {
    // Operator, 2026-09-09: "we need whats on the license card, nothing else."
    const payload =
      '- **Action:** a turn-bolt action on a one-piece forged steel receiver.';
    expect(withoutRefusedCopy(payload)).not.toMatch(/receiver/i);
  });

  it('keeps whole sentences, never mangles one', () => {
    // A fact with a hole in it is a fact the writer may still repeat.
    const payload = 'The barrel is cold hammer-forged. Recoil is mild.';
    expect(withoutRefusedCopy(payload)).toBe('Recoil is mild.');
  });
});

