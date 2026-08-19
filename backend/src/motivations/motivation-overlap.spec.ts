import {
  checkOverlap,
  classifyCalibre,
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
    expect(r.prompt).toMatch(/why you need both/i);
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

  it('tells the writer to address it without inventing a distinction', () => {
    // The standing rule: the model arranges the applicant's facts, it never
    // manufactures circumstances for a firearm application.
    const r = checkOverlap('.30-06 Springfield', [{ calibre: '.308 Winchester' }]);
    expect(r.writerNote).toMatch(/do not invent a distinction/i);
    expect(r.writerNote).toMatch(/only the reason the applicant gave/i);
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
    // never odds — and we must not frighten someone into buying either.
    const r = checkOverlap('.270 Win', [{ calibre: '.308 Win' }]);
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

import { MotivationLicenceType } from '@prisma/client';
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
});
