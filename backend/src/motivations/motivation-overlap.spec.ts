import { MotivationLicenceType } from '@prisma/client';
import {
  checkOverlap,
  classifyAction,
  classifyCalibre,
  classifyFirearmType,
  classifyHeldSection,
  FIREARM_ACTION_LABELS,
  FIREARM_TYPE_LABELS,
  FirearmAction,
  FirearmType,
  HELD_SECTION_LABELS,
  HeldSection,
  QUARRY_LABELS,
  QuarryClass,
} from './motivation-overlap';
import { OVERLAP_ANGLES } from './motivation-cards';

// The operator's own example is the first test, because it is the whole point:
// a .308 already licensed and a .270 applied for are both medium plains game,
// and an occasional hunter who does not explain why they need both gets
// refused for a reason nobody writes down.
//
// The other half of this file is about NOT guessing. The cartridge-spec work in
// this repo needed a 43-agent audit that found twelve dangerous fuzzy matches,
// so anything unrecognised must come back null and become a question.

describe("the operator's example", () => {
  it('catches a .270 applied for against a .308 already held', () => {
    const r = checkOverlap('.270 Winchester', [{ calibre: '.308 Win' }]);
    expect(r.verdict.kind).toBe('overlap');
    expect(r.needsJustification).toBe(true);
    expect(r.prompt).toMatch(/medium plains game/);
    // ⚠️ WHAT WE SAY TO THE APPLICANT IS AN OFFER, NOT A TASK. It used to end
    // "the application should say plainly why you need both... What does this
    // one do that the other cannot?" — homework, on the page of someone who
    // is paying us to write the argument.
    expect(r.prompt).toMatch(/we write that argument for you/i);
    expect(r.prompt).toMatch(/if there is a particular reason of your own/i);
    expect(r.prompt).not.toMatch(/why you need both/i);
    if (r.verdict.kind === 'overlap') {
      expect(r.verdict.quarry).toBe('medium_game');
      expect(r.verdict.withCalibres).toEqual(['.308 Win']);
    }
  });

  it('presses harder when the applicant has no dedicated status', () => {
    // A dedicated shooter holding several similar rifles is ordinary; an
    // occasional hunter has to show this one suits something they actually do.
    const occasional = checkOverlap('.270 Win', [{ calibre: '.308 Win' }], {
      dedicatedStatus: false,
    });
    const dedicated = checkOverlap('.270 Win', [{ calibre: '.308 Win' }], {
      dedicatedStatus: true,
    });
    expect(occasional.writerNote).toMatch(/does NOT hold dedicated status/);
    expect(occasional.writerNote).toMatch(/concrete, practical reason/);
    expect(dedicated.writerNote).toMatch(/dedicated status/);
    expect(dedicated.writerNote).toMatch(/still state the reason/);
  });

  it('tells the writer to ARGUE the distinction, not to wait for one', () => {
    // ⚠️ THIS TEST USED TO ASSERT THE OPPOSITE — "do not invent a
    // distinction", "only the reason the applicant gave" — which left the
    // writer with nothing whenever the applicant wrote nothing, so the
    // pipeline went and asked them. Operator, 2026-08-22: "It is the job of
    // the AI to do research as to why the applicant would need this firearm
    // and justify it for them."
    //
    // The line that survives is rule 8's: the DISTINCTION is rationale and is
    // the writer's to build; a new FACT is still an invention.
    const r = checkOverlap('.30-06 Springfield', [{ calibre: '.308 Winchester' }]);
    expect(r.writerNote).toMatch(/RATIONALE, not a fact about the applicant/);
    expect(r.writerNote).toMatch(/argue it anyway/i);
    expect(r.writerNote).toMatch(/never write that no\s+reason was given/i);
    expect(r.writerNote).toMatch(/MAY NOT DO IS ASSERT A NEW FACT/);
    expect(r.writerNote).toMatch(/never\s+suggest the overlap does not matter/i);
    // And where the applicant DID write something, it leads.
    expect(r.writerNote).toMatch(/LEAD WITH IT/);
  });
});

describe('classifying a calibre', () => {
  it('reads the spellings people actually type', () => {
    for (const s of ['.308 Win', '308 Winchester', '308win', '.308  WIN', '308 Win.']) {
      expect(classifyCalibre(s)).toBe('medium_game');
    }
    expect(classifyCalibre('.22 LR')).toBe('rimfire');
    expect(classifyCalibre('9mm Luger')).toBe('handgun');
    expect(classifyCalibre('12 gauge')).toBe('shotgun');
    expect(classifyCalibre('12ga')).toBe('shotgun');
  });

  it('returns null for anything it does not know, rather than the nearest thing', () => {
    // A wildcat must NOT be pulled to a neighbour. Being wrong here either
    // hides a real overlap or invents one to argue against.
    for (const s of [
      '6.5-284 Norma Improved',
      '.338 Lapua Magnum',
      'something the applicant typed wrong',
      '',
      '   ',
    ]) {
      expect(classifyCalibre(s)).toBeNull();
    }
  });

  it('accepts a bare number only where it is unambiguous', () => {
    // "308" is a .308 Winchester to anyone in this country, so accepting it
    // saves an applicant from a question they would find silly.
    expect(classifyCalibre('308')).toBe('medium_game');
    expect(classifyCalibre('270')).toBe('medium_game');
    // "300" is NOT: Win Mag, WSM, PRC and Blackout are four different
    // arguments, and picking one would put a wrong class on the overlap check.
    expect(classifyCalibre('300')).toBeNull();
    expect(classifyCalibre('30')).toBeNull();
    expect(classifyCalibre('7')).toBeNull();
  });

  it('does not let a substring drag one cartridge onto another', () => {
    // Matching is on the WHOLE collapsed string, never a substring, so a
    // longer name cannot be pulled onto a shorter entry that sits inside it.
    expect(classifyCalibre('.300 Win Mag')).toBe('large_game');
    expect(classifyCalibre('.300 Win Mag')).not.toBe('medium_game');
    expect(classifyCalibre('.30-06 Springfield')).toBe('medium_game');
    expect(classifyCalibre('7.62x39')).toBeNull();
  });

  it('keeps .223 and .308 in different classes', () => {
    // If these ever collapsed together, every plains-game applicant who owns a
    // varminter would be asked to justify an overlap that does not exist.
    expect(classifyCalibre('.223 Remington')).toBe('varmint');
    expect(classifyCalibre('.308 Winchester')).toBe('medium_game');
  });

  it('has a label for every class it can return', () => {
    const classes: QuarryClass[] = [
      'rimfire',
      'varmint',
      'medium_game',
      'large_game',
      'dangerous_game',
      'handgun',
      'shotgun',
    ];
    for (const c of classes) expect(QUARRY_LABELS[c]).toBeTruthy();
  });
});

describe('classifying a firearm type', () => {
  it("reads the registry's own four, whatever the casing", () => {
    for (const s of ['Rifle', 'rifle', ' RIFLE ']) {
      expect(classifyFirearmType(s)).toBe('rifle');
    }
    expect(classifyFirearmType('Shotgun')).toBe('shotgun');
    expect(classifyFirearmType('Handgun')).toBe('handgun');
    expect(classifyFirearmType('Combination')).toBe('combination');
  });

  it('refuses to guess at anything the registry cannot produce', () => {
    // firearm_type and existing_firearm_N_type are both kind: 'choice' over
    // those four, and the extractor drops anything that is not one of them
    // verbatim. Accepting "Pistol" would be this file guessing again.
    for (const s of ['Pistol', 'Revolver', 'Carbine', 'gun', '', '  ', null, undefined]) {
      expect(classifyFirearmType(s)).toBeNull();
    }
  });

  it('has a label for every type it can return', () => {
    const types: FirearmType[] = ['rifle', 'shotgun', 'handgun', 'combination'];
    for (const t of types) expect(FIREARM_TYPE_LABELS[t]).toBeTruthy();
  });
});

// ── the overlap the calibre test cannot see ─────────────────────────
//
// MO000017, live: a Glock in 9mm Parabellum already held, a 6.35mm Browning
// pistol applied for under section 16 dedicated sport. The calibres differ, so
// the calibre test found nothing, so the plan carried no comparison section —
// and the gate marked the document down for its absence. What duplicates on a
// sport or self-defence application is the FIREARM, not the cartridge.

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S16DS = MotivationLicenceType.S16_DEDICATED_SPORT;
const S24 = MotivationLicenceType.S24_RENEWAL;

describe('overlap by firearm type', () => {
  it('catches a second handgun for a dedicated sport shooter', () => {
    const r = checkOverlap('6.35mm Browning', [{ calibre: '9mm Para', type: 'Handgun' }], {
      appliedForType: 'Handgun',
      licenceType: S16DS,
      dedicatedStatus: true,
    });
    expect(r.verdict.kind).toBe('overlap');
    expect(r.needsJustification).toBe(true);
    if (r.verdict.kind === 'overlap') {
      // Nothing matched on calibre — 6.35mm Browning is not in the table at
      // all — so the quarry class stays null rather than being invented.
      expect(r.verdict.quarry).toBeNull();
      expect(r.verdict.withCalibres).toEqual([]);
      expect(r.verdict.firearmType).toBe('handgun');
      expect(r.verdict.withTypes).toEqual(['9mm Para']);
    }
    expect(r.writerNote).toMatch(/two handguns are two handguns/i);
    expect(r.writerNote).toMatch(/course of fire/);
    expect(r.writerNote).toMatch(/MAY NOT DO IS ASSERT A NEW FACT/);
  });

  it('runs even when the applied-for cartridge is unreadable', () => {
    // THE ACTUAL MO000017 FAILURE. An unknown calibre used to return early,
    // and everything after it — including the type — went uncompared.
    expect(classifyCalibre('6.35mm Browning')).toBeNull();
    const r = checkOverlap('6.35mm Browning', [{ calibre: '9mm', type: 'Handgun' }], {
      appliedForType: 'Handgun',
      licenceType: S16DS,
    });
    expect(r.verdict.kind).not.toBe('unknown');
    expect(r.needsJustification).toBe(true);
  });

  it('asks a section 13 applicant where each one is kept', () => {
    // Same test, different question: a self-defence applicant is not choosing
    // between divisions, they are explaining carry against home.
    const r = checkOverlap('.38 Special', [{ calibre: '9mm', type: 'Handgun' }], {
      appliedForType: 'Handgun',
      licenceType: S13,
    });
    expect(r.writerNote).toMatch(/kept or carried/);
    expect(r.writerNote).not.toMatch(/course of fire/);
  });

  it('does not let the calibre table swallow the question that leads', () => {
    // ⚠️ THE ORDER IS LOAD-BEARING. .38 Special and 9mm are both "handgun" to
    // the cartridge table, so a firearm caught by both tests is one firearm —
    // and whichever paragraph runs second is the one that gets deduped away.
    // Calibre-first silently deleted the role question on exactly the two
    // licence types that turn on it.
    const r = checkOverlap(
      '.38 Special',
      [{ calibre: '9mm', type: 'Handgun', describedAs: 'your 9mm Glock' }],
      { appliedForType: 'Handgun', licenceType: S16DS, dedicatedStatus: true },
    );
    expect(r.writerNote).toMatch(/^The applicant already holds your 9mm Glock — the same TYPE/);
    expect(r.writerNote).toMatch(/course of fire/);
    // Named once, not once per test.
    expect(r.writerNote).not.toMatch(/ALSO already holds/);
    expect(r.writerNote).not.toMatch(/in the same class/);
    if (r.verdict.kind === 'overlap') {
      // The verdict still records BOTH findings — only the prose is deduped.
      expect(r.verdict.quarry).toBe('handgun');
      expect(r.verdict.withCalibres).toEqual(['your 9mm Glock']);
      expect(r.verdict.withTypes).toEqual(['your 9mm Glock']);
    }
  });

  it('does not fire when the types genuinely differ', () => {
    const r = checkOverlap('12 gauge', [{ calibre: '9mm', type: 'Handgun' }], {
      appliedForType: 'Shotgun',
      licenceType: S16DS,
    });
    expect(r.verdict.kind).toBe('clear');
    expect(r.needsJustification).toBe(false);
    expect(r.writerNote).toBeNull();
  });

  it('keeps a combination gun to itself', () => {
    // A combination gun carries a rifled and a smooth barrel. Whether that
    // duplicates a rifle is an argument, not a lookup.
    const r = checkOverlap('.308 Win', [{ calibre: '.22 LR', type: 'Rifle' }], {
      appliedForType: 'Combination',
      licenceType: S16DS,
    });
    expect(r.verdict.kind).toBe('clear');
  });

  it('says nothing about type when no type was supplied', () => {
    // Callers that predate the type test pass none, and this must compare only
    // what it was given.
    const r = checkOverlap('6.35mm Browning', [{ calibre: '9mm', type: 'Handgun' }], {
      licenceType: S16DS,
    });
    expect(r.verdict.kind).toBe('unknown');
    expect(r.writerNote).toBeNull();
  });
});

describe('when the quarry leads and the type follows', () => {
  it('still raises a second rifle for a hunter, more softly', () => {
    // The instruction is not to suppress it: an applicant who owns two rifles
    // and applies for a third is asked about it, and the quarry difference is
    // usually the whole answer.
    const r = checkOverlap('.375 H&H', [{ calibre: '.22 LR', type: 'Rifle' }], {
      appliedForType: 'Rifle',
      licenceType: S16,
      dedicatedStatus: true,
    });
    expect(r.needsJustification).toBe(true);
    expect(r.writerNote).toMatch(/A second rifle is still a question worth answering/);
    expect(r.writerNote).toMatch(/the quarry difference IS the answer/);
    // The softer framing is the whole point — it must not read like the sport
    // shooter's "two handguns are two handguns".
    expect(r.writerNote).not.toMatch(/duplicate the ROLE/);
  });

  it('leads with the calibre and adds the type behind it', () => {
    const r = checkOverlap(
      '.270 Win',
      [
        { calibre: '.308 Win', type: 'Rifle', describedAs: 'your .308 Tikka' },
        { calibre: '.22 LR', type: 'Rifle', describedAs: 'your .22 CZ' },
      ],
      { appliedForType: 'Rifle', licenceType: S15 },
    );
    if (r.verdict.kind === 'overlap') {
      expect(r.verdict.quarry).toBe('medium_game');
      expect(r.verdict.withCalibres).toEqual(['your .308 Tikka']);
      expect(r.verdict.withTypes).toEqual(['your .308 Tikka', 'your .22 CZ']);
    }
    // The calibre paragraph comes first, and the .308 is named once, not twice.
    expect(r.writerNote).toMatch(/^The applicant already holds your \.308 Tikka, in the same class/);
    expect(r.writerNote).toMatch(/ALSO already holds your \.22 CZ/);
    expect(r.writerNote).not.toMatch(/ALSO already holds your \.308 Tikka/);
  });
});

describe('when there is nothing to answer for', () => {
  it('is clear when the classes genuinely differ', () => {
    const r = checkOverlap('.375 H&H', [
      { calibre: '.22 LR' },
      { calibre: '9mm' },
      { calibre: '12 gauge' },
    ]);
    expect(r.verdict.kind).toBe('clear');
    expect(r.needsJustification).toBe(false);
    expect(r.prompt).toBeNull();
    // Nothing to argue with means nothing is said to the writer.
    expect(r.writerNote).toBeNull();
  });

  it('is clear on a first firearm', () => {
    const r = checkOverlap('.308 Win', []);
    expect(r.verdict.kind).toBe('clear');
    expect(r.needsJustification).toBe(false);
  });
});

describe('when we cannot tell', () => {
  it('does not claim a clean record just because a held calibre was unreadable', () => {
    // This is the dangerous one. Treating "unreadable" as "no overlap" lets a
    // real overlap through silently, which is the exact failure this module
    // exists to prevent.
    const r = checkOverlap('.270 Win', [{ calibre: '6.5-284 Norma Improved' }]);
    expect(r.verdict.kind).toBe('unknown');
    expect(r.needsJustification).toBe(false);
    expect(r.prompt).toMatch(/could not place/i);
    expect(r.prompt).toMatch(/6\.5-284 Norma Improved/);
  });

  it('says nothing to the writer when the applied-for calibre is unknown', () => {
    const r = checkOverlap('some wildcat', [{ calibre: '.308 Win' }]);
    expect(r.verdict.kind).toBe('unknown');
    expect(r.writerNote).toBeNull();
  });

  it('still finds a real overlap alongside an unreadable one', () => {
    const r = checkOverlap('.270 Win', [
      { calibre: '6.5-284 Norma Improved' },
      { calibre: '.30-06 Springfield' },
    ]);
    expect(r.verdict.kind).toBe('overlap');
    expect(r.needsJustification).toBe(true);
  });
});

describe('how it speaks', () => {
  it('never promises or threatens an outcome', () => {
    // Standing rule across this module: we sell structure and completeness,
    // never odds — and we must not frighten someone into buying either. Every
    // path that can produce words is checked, not only the calibre one.
    const spoken = [
      checkOverlap('.270 Win', [{ calibre: '.308 Win' }]),
      checkOverlap('6.35mm Browning', [{ calibre: '9mm', type: 'Handgun' }], {
        appliedForType: 'Handgun',
        licenceType: S16DS,
      }),
      checkOverlap('.38 Special', [{ calibre: '9mm', type: 'Handgun' }], {
        appliedForType: 'Handgun',
        licenceType: S13,
      }),
      checkOverlap('.375 H&H', [{ calibre: '.22 LR', type: 'Rifle' }], {
        appliedForType: 'Rifle',
        licenceType: S16,
      }),
    ];
    for (const r of spoken) {
      const text = `${r.prompt} ${r.writerNote}`.toLowerCase();
      for (const banned of [
        'will be refused',
        'guarantee',
        'chances',
        'approval',
        'rejected',
      ]) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it('names the actual firearm rather than the class alone', () => {
    // "You already hold a medium game rifle" is useless; "you already hold your
    // .308 Tikka" is something the applicant can answer.
    const r = checkOverlap('.270 Win', [
      { calibre: '.308 Win', describedAs: 'your .308 Tikka T3x' },
    ]);
    expect(r.prompt).toContain('your .308 Tikka T3x');
  });
});

// ── reading it out of the applicant's own answers ───────────────────
//
// This is the half that was missing until 2026-08-19: checkOverlap and its
// tests were live, and NOTHING CALLED THEM. The engine sat there being correct
// while every applicant's document went out without it.

import { overlapFromAnswers } from './motivation-overlap';

const S15 = MotivationLicenceType.S15_OCCASIONAL_HUNTER;
const S16 = MotivationLicenceType.S16_DEDICATED_HUNTER;

describe('overlapFromAnswers', () => {
  it("finds the operator's example straight out of the wizard's fields", () => {
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.270 Winchester',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_1_make: 'Tikka',
      existing_firearm_1_type: 'Rifle',
    });
    expect(r.needsJustification).toBe(true);
    expect(r.prompt).toContain('.308 Win Tikka rifle');
    expect(r.writerNote).toMatch(/medium plains game/);
  });

  it('reads every owned row, not just the first', () => {
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '12 gauge',
      existing_firearm_1_calibre: '.22 LR',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_4_calibre: '20 gauge',
      existing_firearm_4_section_held: 'section_15',
    });
    expect(r.needsJustification).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // A FIREARM HELD UNDER ANOTHER SECTION IS NOT AN OVERLAP AT ALL.
  //
  // Operator, 2026-09-09, on a section 13 application raising the box against
  // a section 16 handgun: "the cz is section 16 so it does not matter and it
  // cant be carried as a self defense weapon. This box can only pop up if
  // there is a section 13 license already in the vault, period."
  //
  // A licence is issued under a section FOR A PURPOSE. A handgun on a section
  // 16 licence is held for sport or hunting and is not licensed to be carried
  // for defence — so a section 13 application is asking for the FIRST firearm
  // licensed to do that job, not a second one to do the same job.
  //
  // ⚠️ THIS SUPERSEDES 3765c07a, which only made the writer LEAD with the
  // section difference. Softening an argument that should not exist is still
  // an argument.
  // ────────────────────────────────────────────────────────────────

  it("⚠️ THE OPERATOR'S CASE: a section 16 handgun, a section 13 application", () => {
    const r = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm Parabellum',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '6.35mm Browning',
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_section_held: 'section_16',
    });
    expect(r.needsJustification).toBe(false);
    expect(r.prompt).toBeNull();
    expect(r.writerNote).toBeNull();
    expect(r.suggestedAngle).toBeNull();
  });

  it('and raises it where a section 13 IS already held', () => {
    // The same two handguns, one card value different. This is the case the
    // box exists for, and s13(3) caps it at one licence besides.
    const r = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm Parabellum',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '6.35mm Browning',
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_section_held: 'section_13',
    });
    expect(r.needsJustification).toBe(true);
    expect(r.prompt).toContain('CZ');
  });

  it('⚠️ TREATS AN UNKNOWN SECTION AS NOT THE SAME ONE', () => {
    // "period" — and the cost is accepted deliberately. A same-section
    // duplicate whose card we could not read loses its argument; the
    // alternative is a paragraph arguing with a firearm that was never in
    // competition. Either way the battery table still names it and still
    // gives it a sentence: heading 6 is conditional on holding ANYTHING, not
    // on an overlap.
    for (const section of ['', 'unsure', 'section_17', 'section_20']) {
      const r = overlapFromAnswers(S13, {
        firearm_type: 'Handgun',
        firearm_calibre: '9mm Parabellum',
        existing_firearm_1_type: 'Handgun',
        existing_firearm_1_calibre: '.38 Special',
        existing_firearm_1_section_held: section,
      });
      expect(r.needsJustification).toBe(false);
    }
  });

  it('⚠️ READS THE KEY THE REGISTRY ACTUALLY WRITES', () => {
    // This module read `existing_firearm_N_section` — a key nothing has ever
    // written. The field landed on 2026-09-09 as `section_held`, with the
    // statutory-cap warnings, so the section axis had never once fired in
    // production and every held firearm looked like an unknown section.
    const withRealKey = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm Parabellum',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '.38 Special',
      existing_firearm_1_section_held: 'section_13',
    });
    const withDeadKey = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm Parabellum',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '.38 Special',
      existing_firearm_1_section: 'section_13',
    });
    expect(withRealKey.needsJustification).toBe(true);
    expect(withDeadKey.needsJustification).toBe(false);
  });

  it('keeps a section 16 rifle competing with a section 16 application', () => {
    // The rule is "the same section", not "never". A dedicated hunter's second
    // rifle in the same class is exactly what the argument is for.
    const r = overlapFromAnswers(S16, {
      firearm_calibre: '.270 Win',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_make: 'Tikka',
      existing_firearm_1_type: 'Rifle',
      existing_firearm_1_section_held: 'section_16',
    });
    expect(r.needsJustification).toBe(true);
  });

  it('counts only the competing rows, not every firearm held', () => {
    // One of each. Only the section 13 handgun may raise the box.
    const r = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm Parabellum',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '6.35mm Browning',
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_section_held: 'section_16',
      existing_firearm_2_type: 'Handgun',
      existing_firearm_2_calibre: '.38 Special',
      existing_firearm_2_make: 'Taurus',
      existing_firearm_2_section_held: 'section_13',
    });
    expect(r.needsJustification).toBe(true);
    expect(r.prompt).toContain('Taurus');
    expect(r.prompt).not.toContain('CZ');
  });

  it('is quiet when nothing is owned yet', () => {
    const r = overlapFromAnswers(S15, { firearm_calibre: '.308 Win' });
    expect(r.needsJustification).toBe(false);
    expect(r.writerNote).toBeNull();
  });

  it('derives dedicated status from the LICENCE TYPE, not from a claim', () => {
    // A section 16 application IS the dedicated path. Reading it off an answer
    // would let the applicant soften the question by typing something.
    // ⚠️ TWO FIXTURES NOW, NOT ONE SHARED ONE. A held firearm only competes
    // when it is under the SECTION BEING APPLIED FOR, so one row cannot be an
    // overlap for both a section 15 and a section 16 application. That is the
    // rule under test elsewhere; here it just means the fixture has to be
    // honest about which application each reading belongs to.
    const held = (section: string) => ({
      firearm_calibre: '.270 Win',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: section,
    });
    expect(overlapFromAnswers(S16, held('section_16')).writerNote).toMatch(
      /holds dedicated status/,
    );
    expect(overlapFromAnswers(S15, held('section_15')).writerNote).toMatch(
      /does NOT hold dedicated status/,
    );
  });

  it('describes the firearm the way the applicant would recognise it', () => {
    // "your .308 Tikka rifle" is answerable; "a medium game rifle" is not.
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.30-06 Springfield',
      existing_firearm_1_calibre: '.308 Winchester',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_type: 'Rifle',
    });
    expect(r.prompt).toContain('.308 Winchester CZ rifle');
  });

  it('ignores a row with a make but no calibre', () => {
    // Half-typed rows are normal in a wizard and must not be read as owning
    // something unclassifiable.
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.308 Win',
      existing_firearm_1_make: 'Tikka',
    });
    expect(r.verdict.kind).toBe('clear');
  });

  it('reads MO000017 the way it was actually answered', () => {
    // The live shape: a Glock 9mm held, a 6.35mm Browning pistol applied for
    // under section 16 dedicated sport. This came back clear, so the plan had
    // no comparison section, so the gate scored completeness 40.
    const r = overlapFromAnswers(S16DS, {
      firearm_type: 'Handgun',
      firearm_calibre: '6.35mm Browning',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm Parabellum',
      existing_firearm_1_make: 'Glock',
      // The Glock is on a section 16 licence too, so it genuinely competes.
      existing_firearm_1_section_held: 'section_16',
    });
    expect(r.needsJustification).toBe(true);
    expect(r.prompt).toContain('9mm Parabellum Glock handgun');
    expect(r.writerNote).toMatch(/two handguns are two handguns/i);
  });

  it('keeps a row that has a type but no readable calibre', () => {
    // A licence upload that yields "Handgun" and nothing legible in the
    // calibre box is ordinary, and used to be dropped on the floor.
    const r = overlapFromAnswers(S13, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm',
      existing_firearm_1_type: 'Handgun',
      // The section is what decides whether it competes at all; the calibre
      // being unreadable is the thing under test here.
      existing_firearm_1_section_held: 'section_13',
    });
    expect(r.needsJustification).toBe(true);
    // Nothing to name it by, so it is given an article rather than read out
    // as "you already hold handgun".
    expect(r.prompt).toContain('a handgun');
  });
});

// ── the renewal that overlaps with itself ───────────────────────────
//
// ⚠️ A RENEWAL APPLICANT GENUINELY HOLDS THE FIREARM BEING RENEWED, and the
// section they type it into is headed "Firearms you already own". Worse, those
// rows are docSourced from CURRENT_LICENCE — and on a renewal the current
// licence IS the one being renewed, so the extractor fills the row in for them.
// Naively checked, the document argues why a firearm does not duplicate itself.

describe('a section 24 renewal', () => {
  const renewing = {
    firearm_type: 'Handgun',
    firearm_calibre: '9mm',
    firearm_make: 'Glock',
    firearm_serial: 'ABC12345',
    existing_licence_number: 'LIC-99887766',
  };

  it('does not argue that the firearm duplicates itself, matched on licence number', () => {
    const r = overlapFromAnswers(S24, {
      ...renewing,
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_make: 'Glock',
      existing_firearm_1_licence_no: 'LIC 99887766',
    });
    expect(r.needsJustification).toBe(false);
    expect(r.writerNote).toBeNull();
  });

  it('identifies it by serial when the licence number is not on the row', () => {
    // The RETIRED `_frame_serial` key — a draft saved before the two serial
    // questions collapsed into one still has to identify its own renewal.
    const r = overlapFromAnswers(S24, {
      ...renewing,
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_frame_serial: 'abc 12345',
    });
    expect(r.needsJustification).toBe(false);
  });

  // ⚠️ NO MAKE ANYWHERE IN THE NEXT TWO, ON PURPOSE. The last-resort
  // type+calibre+make test would otherwise identify the renewal on its own and
  // both tests would pass whether the serial branch worked or not — which is
  // exactly how the first drafts of them passed against the broken reader. A
  // twin in a second row is what turns "the row was not found" into a visible
  // verdict: an unfound renewal returns `clear` for the WHOLE check, so a real
  // second firearm stops being argued about at all.
  it('identifies the renewal by the serial key the registry now asks for', () => {
    // ⚠️ THE BRANCH THAT WENT OUT OF SERVICE. This file read
    // `_barrel_serial` / `_frame_serial` directly; both were retired on
    // 2026-09-07 in favour of one `_serial`, so on every application written
    // since, the serial branch could never match — and an unmatched renewal
    // falls through to -1, which waives the entire overlap check.
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm',
      firearm_serial: 'ABC12345',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_serial: 'abc 12345',
      existing_firearm_2_type: 'Handgun',
      existing_firearm_2_calibre: '9mm',
      existing_firearm_2_licence_no: 'LIC-11223344',
    });
    // Row 1 is the renewal and goes; row 2 is a real second firearm and the
    // duplicate-calibre ground is still raised about it.
    expect(r.verdict.kind).toBe('overlap');
    expect(r.needsJustification).toBe(true);
    expect(r.writerNote).toMatch(/This is a renewal/);
  });

  it('reaches a renewal sitting in a row beyond the old six', () => {
    // The registry offers fourteen rows; this file capped its own loop at six,
    // so a member whose renewal landed in row 7 or later was invisible to
    // every test in this module — the removal above AND the duplicate-calibre
    // argument the module exists to make.
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm',
      firearm_serial: 'ABC12345',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_licence_no: 'LIC-11223344',
      existing_firearm_14_type: 'Handgun',
      existing_firearm_14_calibre: '9mm',
      existing_firearm_14_serial: 'abc 12345',
    });
    expect(r.verdict.kind).toBe('overlap');
    expect(r.needsJustification).toBe(true);
  });

  it('identifies it by type, calibre and make when there is no number at all', () => {
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm',
      firearm_make: 'Glock',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_make: 'Glock',
    });
    expect(r.needsJustification).toBe(false);
  });

  it('removes ONE row, so an identical twin is still asked about', () => {
    // Two Glock 9mms, one being renewed. The other is a real second firearm
    // and the calibre test should still see it.
    const r = overlapFromAnswers(S24, {
      ...renewing,
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_make: 'Glock',
      existing_firearm_1_licence_no: 'LIC-99887766',
      existing_firearm_2_type: 'Handgun',
      existing_firearm_2_calibre: '9mm',
      existing_firearm_2_make: 'Glock',
      existing_firearm_2_licence_no: 'LIC-11223344',
    });
    expect(r.needsJustification).toBe(true);
    if (r.verdict.kind === 'overlap') {
      expect(r.verdict.withCalibres).toEqual(['9mm Glock handgun']);
    }
    // A renewal acquires nothing, so the note asks about continued need rather
    // than about justifying a further firearm.
    expect(r.writerNote).toMatch(/This is a renewal/);
    expect(r.writerNote).toMatch(/continues to need this firearm alongside/);
    expect(r.writerNote).not.toMatch(/dedicated status/);
  });

  it('still raises a genuinely different calibre once the renewed one is set aside', () => {
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Rifle',
      firearm_calibre: '.270 Win',
      firearm_make: 'Tikka',
      existing_licence_number: 'LIC-1',
      existing_firearm_1_type: 'Rifle',
      existing_firearm_1_calibre: '.270 Win',
      existing_firearm_1_make: 'Tikka',
      existing_firearm_1_licence_no: 'LIC-1',
      existing_firearm_2_type: 'Rifle',
      existing_firearm_2_calibre: '.308 Win',
      existing_firearm_2_make: 'CZ',
      existing_firearm_2_licence_no: 'LIC-2',
    });
    expect(r.needsJustification).toBe(true);
    expect(r.writerNote).toMatch(/medium plains game/);
  });

  it('never runs the TYPE test on a renewal', () => {
    // Two rifles, different calibre classes, and the renewed one identified and
    // removed. On any other licence type the leftover rifle would be raised as
    // a secondary type match; on a renewal it would only ever restate the
    // application — the applicant is not acquiring a rifle, they have one.
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Rifle',
      firearm_calibre: '.375 H&H',
      firearm_make: 'CZ',
      existing_licence_number: 'LIC-1',
      existing_firearm_1_type: 'Rifle',
      existing_firearm_1_calibre: '.375 H&H',
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_licence_no: 'LIC-1',
      existing_firearm_2_type: 'Rifle',
      existing_firearm_2_calibre: '.22 LR',
      existing_firearm_2_make: 'Anschutz',
      existing_firearm_2_licence_no: 'LIC-2',
    });
    expect(r.verdict.kind).toBe('clear');
    expect(r.writerNote).toBeNull();
  });

  it('stays silent when it cannot tell which row is the renewal', () => {
    // No licence number, no serial, and a make that does not line up. A handgun
    // sitting beside a handgun renewal is far more likely to BE the renewal
    // than to be a second one, and a false overlap puts a paragraph into a SAPS
    // submission arguing against a problem the applicant does not have.
    const r = overlapFromAnswers(S24, {
      firearm_type: 'Handgun',
      firearm_calibre: '9mm',
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
    });
    expect(r.verdict.kind).toBe('clear');
    expect(r.needsJustification).toBe(false);
    expect(r.writerNote).toBeNull();
  });
});

describe('one argument per firearm, not one passage covering them all', () => {
  // ⚠️ THE CORPUS'S DEFINING HABIT. The worked motivations NATSHOOT supplied
  // give a short paragraph to EACH firearm held — one hunting example runs
  // seven, including two shotguns inside a rifle application. A joined list
  // reliably produces a single lumped passage instead, which does not answer
  // the check a DFO actually does: pull the licence record, count what is
  // already there, one at a time.

  it('names each matched firearm on its own line', () => {
    const r = checkOverlap('.308 Win', [
      { calibre: '.308 Win', describedAs: '.308 Win Tikka', usedFor: 'plains game to 250m' },
      { calibre: '.30-06', describedAs: '.30-06 Mauser', usedFor: 'kudu in thick bush' },
    ]);
    expect(r.writerNote).toContain('TAKE THESE ONE AT A TIME');
    expect(r.writerNote).toContain('.308 Win Tikka — the applicant uses it for: plains game to 250m.');
    expect(r.writerNote).toContain('.30-06 Mauser — the applicant uses it for: kudu in thick bush.');
  });

  it('forbids reusing the same closing sentence', () => {
    // In the corpus the same disqualifying clause is pasted four times almost
    // word for word. Take the paragraph; refuse the sentence — maxSimilarity
    // and fingerprint() exist to catch exactly that, and copying it would be
    // manufacturing the signal ourselves.
    const r = checkOverlap('.308 Win', [{ calibre: '.308 Win' }]);
    expect(r.writerNote).toMatch(/do not reuse the same closing sentence/i);
  });

  it('⚠️ REFUSES TO STATE A USE THE APPLICANT NEVER GAVE', () => {
    // What somebody uses a firearm for is HISTORY under rule 8 — verifiable,
    // theirs, and barred unless supplied. The distinction between two
    // firearms is rationale and stays the writer's job. Handing the writer a
    // per-firearm brief without the use would have aimed pure invention
    // pressure at rule 1, which is the trap the field closes.
    const r = checkOverlap('.308 Win', [
      { calibre: '.308 Win', describedAs: '.308 Win Tikka' },
    ]);
    expect(r.writerNote).toContain('no stated use');
    expect(r.writerNote).toMatch(/do NOT state what they use it for/);
  });

  it('does not repeat a firearm that matches on BOTH calibre and type', () => {
    const r = checkOverlap('9mm', [{ calibre: '9mm', type: 'Handgun', describedAs: '9mm Glock' }], {
      appliedForType: 'Handgun',
    });
    const hits = (r.writerNote!.match(/• 9mm Glock/g) ?? []).length;
    expect(hits).toBe(1);
  });
});

// ── THE ACTION AXIS — SAME CALIBRE CLASS, DIFFERENT WEIGHT ──────────
//
// A bolt-action .308 and a semi-automatic .308 are the same calibre class and,
// until now, read as the identical duplication. Two bolt .308s are the closer
// one and the harder to explain away; a bolt against a semi-auto is genuinely
// lighter, because a reviewer sees two rifles built for different jobs. This
// axis never decides whether there IS an overlap — it only tells the writer
// how hard to press once calibre or type already has.

describe('classifying an action', () => {
  it("reads the registry's own seven, whatever the casing", () => {
    for (const s of ['Bolt action', 'bolt action', ' BOLT ACTION ']) {
      expect(classifyAction(s)).toBe('bolt');
    }
    expect(classifyAction('Semi-automatic (self-loading)')).toBe('semi_auto');
    expect(classifyAction('Lever action')).toBe('lever');
    expect(classifyAction('Pump action')).toBe('pump');
    expect(classifyAction('Single shot')).toBe('single_shot');
    expect(classifyAction('Revolver')).toBe('revolver');
    expect(classifyAction('Break action')).toBe('break');
  });

  it('refuses to guess at a shorthand the registry cannot produce', () => {
    // `firearm_action` is `kind: 'choice'` over exactly the seven full
    // strings; a partial word or a synonym cannot come out of it, so
    // accepting one would be this file guessing again.
    for (const s of ['Bolt', 'Auto', 'Semi-auto', 'Manual', '', '  ', null, undefined]) {
      expect(classifyAction(s)).toBeNull();
    }
  });

  it('has a label for every action it can return', () => {
    const actions: FirearmAction[] = [
      'semi_auto',
      'bolt',
      'lever',
      'pump',
      'single_shot',
      'revolver',
      'break',
    ];
    for (const a of actions) expect(FIREARM_ACTION_LABELS[a]).toBeTruthy();
  });
});

describe('classifying the section a held firearm is licensed under', () => {
  it('reads the spellings the licence-card reader and a person might use', () => {
    for (const s of ['13', 'Section 13', 'SECTION 13', 'S13']) {
      expect(classifyHeldSection(s)).toBe('13');
    }
    expect(classifyHeldSection('SECTION 15')).toBe('15');
    expect(classifyHeldSection('SECTION 16')).toBe('16');
  });

  it('is THREE, not four — section 24 is a renewal process, not a grant', () => {
    // Nothing is ever "held under section 24": a renewed firearm keeps
    // whichever of 13/15/16 it was originally granted under. See the type's
    // own comment for the fuller argument.
    for (const s of ['24', 'Section 24', 'S24', '20', 'S17', '', null, undefined]) {
      expect(classifyHeldSection(s)).toBeNull();
    }
  });

  it('has a label for every section it can return', () => {
    const sections: HeldSection[] = ['13', '15', '16'];
    for (const s of sections) expect(HELD_SECTION_LABELS[s]).toBeTruthy();
  });
});

describe('the action and section axes weaken or sharpen a matched note', () => {
  it('reads as a CLOSER duplication when the action also matches', () => {
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', action: 'Bolt action' }],
      { appliedForAction: 'Bolt action' },
    );
    expect(r.writerNote).toMatch(/CLOSER duplication/);
  });

  it('reads as a LIGHTER duplication when the action differs', () => {
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', action: 'Semi-automatic (self-loading)' }],
      { appliedForAction: 'Bolt action' },
    );
    expect(r.writerNote).toMatch(/LIGHTER duplication/);
    expect(r.writerNote).toMatch(/bolt action/);
    expect(r.writerNote).toMatch(/semi-automatic/);
    // Still an instruction to address it, never an excuse to skip it.
    expect(r.writerNote).toMatch(/do not argue it as if the two were the same firearm/);
  });

  it('says nothing about action when either side is unknown', () => {
    // No `action` on the held firearm at all — the overwhelming majority of
    // rows today, since the registry has no field for it yet.
    const r = checkOverlap('.308 Win', [{ calibre: '.308 Win' }], {
      appliedForAction: 'Bolt action',
    });
    expect(r.writerNote).not.toMatch(/duplication/);
  });

  it('names the SAME section when a held firearm was granted under this application\'s own section', () => {
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', section: 'SECTION 16' }],
      { licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER },
    );
    expect(r.writerNote).toMatch(/licensed under the SAME section/);
  });

  it('names a DIFFERENT section, and which one, when they do not match', () => {
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', section: 'SECTION 13' }],
      { licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER },
    );
    expect(r.writerNote).toMatch(/a DIFFERENT section from the one applied for/);
    expect(r.writerNote).toMatch(/section 13 \(self-defence\)/);
    /**
     * ⚠️ AND IT SAYS THE DIFFERENCE IS THE ANSWER, not that it is worth a
     * mention. Operator, 2026-09-09: "If someone owns a handgun and its on
     * section 16. Then the new applicant is allowed to apply for a section 13
     * of that firearm if they do meet all the other conditions." A licence is
     * issued under a section FOR A PURPOSE, so a firearm held under another
     * one is not a second firearm doing the same job.
     */
    expect(r.writerNote).toMatch(/SAY THIS FIRST AND STOP THERE/);
  });

  it('says nothing about section on a renewal — nothing is being applied for under a new one', () => {
    const r = checkOverlap(
      '.270 Win',
      [{ calibre: '.308 Win', section: 'SECTION 16' }],
      { licenceType: MotivationLicenceType.S24_RENEWAL },
    );
    // Calibre overlap still fires; the section clause does not, because
    // sectionAppliedFor is null on S24.
    expect(r.needsJustification).toBe(true);
    expect(r.writerNote).not.toMatch(/section/i);
  });

  it('joins both clauses when both action and section are known', () => {
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', action: 'Bolt action', section: 'SECTION 13' }],
      {
        appliedForAction: 'Bolt action',
        licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      },
    );
    /**
     * ⚠️ THE SECTION LEADS AND THE ACTION FOLLOWS, WHICH IS A REVERSAL. It
     * used to read "CLOSER duplication ... DIFFERENT section": the writer was
     * told to press a duplication first and given the licence difference as an
     * afterthought, so the document argued at length about an objection the
     * licence card answers in a line. With the sections differing, matching
     * actions are what makes the two look alike on a register — not what makes
     * them compete for one role.
     */
    expect(r.writerNote).toMatch(
      /a DIFFERENT section from the one applied for[\s\S]*makes the two look alike on a register/,
    );
    expect(r.writerNote).not.toMatch(/CLOSER duplication/);
  });

  it('⚠️ STILL PRESSES A CLOSER DUPLICATION WHEN THE SECTIONS AGREE', () => {
    // The softening is about the LICENCE, not about the action. Two bolt
    // rifles both held under section 16 really are two firearms competing for
    // one role, and the paragraph has to answer that on its merits.
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', action: 'Bolt action', section: 'SECTION 16' }],
      {
        appliedForAction: 'Bolt action',
        licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      },
    );
    expect(r.writerNote).toMatch(/CLOSER duplication — press it/);
    expect(r.writerNote).toMatch(/the duplication is real/);
  });

  it('describes a mismatched section honestly IF it is ever handed one', () => {
    // ⚠️ THIS IS NO LONGER A LIVE PATH, AND THE TITLE USED TO SAY IT WAS.
    // It read "THE OPERATOR'S OWN CASE: a section 16 handgun, a section 13
    // application", and the case was answered twice on 2026-09-09. First by
    // softening the argument — say the section difference and stop there.
    // Then by the operator going further: "the cz is section 16 so it does not
    // matter and it cant be carried as a self defense weapon. This box can
    // only pop up if there is a section 13 license already in the vault,
    // period." overlapFromAnswers now drops the row before checkOverlap sees
    // it, so this combination cannot arise in production — see the
    // overlapFromAnswers block for the case as it now behaves.
    //
    // What is left under test is the PRIMITIVE. checkOverlap is exported and
    // takes what it is given; asked about a mismatched section it must still
    // describe it truthfully rather than press a duplication the licence
    // disposes of. Deleting that branch would make a direct caller silently
    // wrong the day the upstream filter is loosened.
    const r = checkOverlap(
      '9mm Luger',
      [
        {
          calibre: '9mm Luger',
          type: 'Handgun',
          action: 'Semi-automatic',
          section: 'SECTION 16',
        },
      ],
      {
        appliedForType: 'Handgun',
        appliedForAction: 'Semi-automatic',
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
      },
    );
    expect(r.needsJustification).toBe(true);
    expect(r.writerNote).toMatch(/section 16 \(dedicated hunter or sport shooter\)/);
    expect(r.writerNote).toMatch(/does not cover the purpose of this application/);
    expect(r.writerNote).not.toMatch(/CLOSER duplication/);
    // ⚠️ AND THE MEMBER IS OFFERED NO SUCH SENTENCE ANY MORE. The
    // `different_section` card is gone: the box only appears when the sections
    // MATCH, which made "I hold that one under a different section" false
    // wherever anybody could see it — in a sentence that goes verbatim into a
    // document they sign.
    expect((r.suggestedAngle ?? []).map((a) => a.key)).not.toContain(
      'different_section',
    );
  });

  it('never lets the strength clause slip into the applicant-facing prompt', () => {
    // The prompt stays high-level; the nuance belongs to the writer alone.
    const r = checkOverlap(
      '.308 Win',
      [{ calibre: '.308 Win', action: 'Bolt action' }],
      { appliedForAction: 'Bolt action' },
    );
    expect(r.prompt).not.toMatch(/duplication/);
  });
});

// ── suggestedAngle — A RANKED SUBSET OF THE FIXED VOCABULARY ────────
//
// motivation-cards.ts owns the seven sentences; this file only ever reorders
// them. Every test below checks the full seven survive, in a set, alongside
// the order asserted for the ones that matter.

function angleKeys(check: ReturnType<typeof checkOverlap>): string[] {
  return (check.suggestedAngle ?? []).map((o) => o.key);
}

describe('suggestedAngle', () => {
  it('is null when there is nothing to explain', () => {
    const clear = checkOverlap('.375 H&H', [{ calibre: '.22 LR' }]);
    expect(clear.verdict.kind).toBe('clear');
    expect(clear.suggestedAngle).toBeNull();
  });

  it('is null when we do not even know what is being compared', () => {
    const unknownApplied = checkOverlap('some wildcat', [{ calibre: '.308 Win' }]);
    expect(unknownApplied.verdict.kind).toBe('unknown');
    expect(unknownApplied.suggestedAngle).toBeNull();

    const unknownHeld = checkOverlap('.270 Win', [
      { calibre: '6.5-284 Norma Improved' },
    ]);
    expect(unknownHeld.verdict.kind).toBe('unknown');
    expect(unknownHeld.suggestedAngle).toBeNull();
  });

  it('never filters — every angle survives, whatever fires first', () => {
    const cases = [
      checkOverlap('.270 Win', [{ calibre: '.308 Win' }], {
        dedicatedStatus: true,
        licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      }),
      checkOverlap('.375 H&H', [{ calibre: '.22 LR', type: 'Rifle' }], {
        appliedForType: 'Rifle',
        licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      }),
      checkOverlap('.38 Special', [{ calibre: '9mm', type: 'Handgun' }], {
        appliedForType: 'Handgun',
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
      }),
    ];
    const wanted = [...OVERLAP_ANGLES.map((o) => o.key)].sort();
    for (const c of cases) {
      expect(angleKeys(c).sort()).toEqual(wanted);
      // ⚠️ THE SET'S OWN LENGTH, NOT A LITERAL. This read `toHaveLength(7)`
      // and broke the day OVERLAP_ANGLES grew — which is the set doing its job,
      // not a regression. What this case is about is that NOTHING is filtered
      // out, whichever rule fired first, and `wanted` above already says so.
      expect(angleKeys(c)).toHaveLength(OVERLAP_ANGLES.length);
    }
  });

  it('leads with division, backup and match-and-practice for a dedicated shooter with a same-calibre overlap', () => {
    const r = checkOverlap('.270 Win', [{ calibre: '.308 Win' }], {
      dedicatedStatus: true,
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
    });
    expect(angleKeys(r).slice(0, 3)).toEqual([
      'different_division',
      'backup',
      'match_and_practice',
    ]);
  });

  it('does NOT lead with the dedicated framing for the same overlap without dedicated status', () => {
    const r = checkOverlap('.270 Win', [{ calibre: '.308 Win' }], {
      dedicatedStatus: false,
      licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
    });
    expect(angleKeys(r).slice(0, 3)).not.toEqual([
      'different_division',
      'backup',
      'match_and_practice',
    ]);
  });

  it('leads with different quarry and different range when the type matches but the calibre class does not', () => {
    // Two rifles, genuinely different game — the softer, "secondary" framing
    // typeParagraph already writes for a hunter.
    const r = checkOverlap('.375 H&H', [{ calibre: '.22 LR', type: 'Rifle' }], {
      appliedForType: 'Rifle',
      licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      dedicatedStatus: true,
    });
    expect(angleKeys(r).slice(0, 2)).toEqual(['different_quarry', 'different_range']);
  });

  it('falls back to different format and different purpose for a type-led match with no dedicated status', () => {
    // MO000017's own shape, without dedicated status: two handguns, the
    // firearm type test is what fires, and there is no Act-recognised
    // "division" framing to reach for.
    const r = checkOverlap('.38 Special', [{ calibre: '9mm', type: 'Handgun' }], {
      appliedForType: 'Handgun',
      licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
    });
    expect(angleKeys(r).slice(0, 2)).toEqual(['different_format', 'different_purpose']);
  });

  it('ranks different_purpose first when a held firearm is for self-defence and this application is for sport', () => {
    // The brief's own example. A held handgun tapped as home defence, next to
    // a dedicated SPORT application in the same calibre class — the mismatch
    // is worth more than the generic dedicated-shooter framing, so it leads.
    const r = checkOverlap(
      '9mm',
      [{ calibre: '9mm', usedForKeys: ['home_defence'] }],
      { dedicatedStatus: true, licenceType: MotivationLicenceType.S16_DEDICATED_SPORT },
    );
    expect(angleKeys(r)[0]).toBe('different_purpose');
    expect(angleKeys(r)).toEqual(
      expect.arrayContaining([
        'different_division',
        'backup',
        'match_and_practice',
      ]),
    );
  });

  it('does not rank by purpose from free text, only from the tapped card', () => {
    // usedFor is prose for the writer; usedForKeys is the fixed vocabulary
    // this ranking compares against exactly. Free text has no fixed
    // vocabulary to match, so it must not move the ranking — only the tapped
    // PRIMARY_USE card can.
    const withoutKeys = checkOverlap(
      '9mm',
      [{ calibre: '9mm', usedFor: 'I keep it for home defence.' }],
      { dedicatedStatus: true, licenceType: MotivationLicenceType.S16_DEDICATED_SPORT },
    );
    expect(angleKeys(withoutKeys)[0]).not.toBe('different_purpose');
  });

  it('treats section 15 as hunting for the purpose signal, since it also covers sport shooters', () => {
    // S15 genuinely covers "an occasional hunter OR an occasional sports
    // person" and this module has no independent way to tell which. A held
    // firearm for hunting next to an S15 application is therefore read as
    // no-conflict, which costs nothing when the S15 applicant actually shoots
    // sport — ranking only ever reorders, it never removes an angle.
    const r = checkOverlap(
      '.270 Win',
      [{ calibre: '.308 Win', usedForKeys: ['plains_game'] }],
      { licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER },
    );
    expect(angleKeys(r)[0]).not.toBe('different_purpose');
  });
});

// ── overlapFromAnswers reads the tapped card, action and section ───
// (overlapFromAnswers is already imported above, ahead of the S24 tests.)

describe('overlapFromAnswers reads existing_firearm_N_primary_use', () => {
  it('prefers the tapped card over the older free-text answer', () => {
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.270 Winchester',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_1_primary_use: 'plains_game',
      existing_firearm_1_use: 'the old free-text answer, never shown once the card is tapped',
    });
    expect(r.writerNote).toContain('I use it for plains game.');
    expect(r.writerNote).not.toContain('the old free-text answer');
  });

  it('falls back to the free-text answer when the card was never tapped', () => {
    // ⚠️ NEVER LOSE AN ANSWER SOMEBODY ALREADY TYPED. A draft saved before
    // the card existed must still reach the writer.
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.270 Winchester',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_1_use: 'bushveld plains game to 200m',
    });
    expect(r.writerNote).toContain('bushveld plains game to 200m');
  });

  it('drops an unrecognised or retired card key rather than printing the raw slug', () => {
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.270 Winchester',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: 'section_15',
      existing_firearm_1_primary_use: 'not_a_real_key',
    });
    expect(r.writerNote).not.toContain('not_a_real_key');
    expect(r.writerNote).toContain('no stated use');
  });

  it('passes firearm_action through so the action axis can fire from real answers', () => {
    const r = overlapFromAnswers(S16, {
      firearm_calibre: '.270 Winchester',
      firearm_action: 'Semi-automatic (self-loading)',
      existing_firearm_1_calibre: '.308 Win',
      existing_firearm_1_section_held: 'section_16',
      // ⚠️ NO REGISTRY FIELD YET — read defensively (see HeldFirearm.action).
      // This proves the plumbing works the day it lands.
      existing_firearm_1_action: 'Bolt action',
    });
    expect(r.writerNote).toMatch(/LIGHTER duplication/);
  });
});
