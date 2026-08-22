import { MotivationLicenceType } from '@prisma/client';
import {
  checkOverlap,
  classifyCalibre,
  classifyFirearmType,
  FIREARM_TYPE_LABELS,
  FirearmType,
  QUARRY_LABELS,
  QuarryClass,
} from './motivation-overlap';

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
      existing_firearm_4_calibre: '20 gauge',
    });
    expect(r.needsJustification).toBe(true);
  });

  it('is quiet when nothing is owned yet', () => {
    const r = overlapFromAnswers(S15, { firearm_calibre: '.308 Win' });
    expect(r.needsJustification).toBe(false);
    expect(r.writerNote).toBeNull();
  });

  it('derives dedicated status from the LICENCE TYPE, not from a claim', () => {
    // A section 16 application IS the dedicated path. Reading it off an answer
    // would let the applicant soften the question by typing something.
    const answers = {
      firearm_calibre: '.270 Win',
      existing_firearm_1_calibre: '.308 Win',
    };
    expect(overlapFromAnswers(S16, answers).writerNote).toMatch(
      /holds dedicated status/,
    );
    expect(overlapFromAnswers(S15, answers).writerNote).toMatch(
      /does NOT hold dedicated status/,
    );
  });

  it('describes the firearm the way the applicant would recognise it', () => {
    // "your .308 Tikka rifle" is answerable; "a medium game rifle" is not.
    const r = overlapFromAnswers(S15, {
      firearm_calibre: '.30-06 Springfield',
      existing_firearm_1_calibre: '.308 Winchester',
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
    const r = overlapFromAnswers(S24, {
      ...renewing,
      existing_firearm_1_type: 'Handgun',
      existing_firearm_1_calibre: '9mm',
      existing_firearm_1_frame_serial: 'abc 12345',
    });
    expect(r.needsJustification).toBe(false);
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
