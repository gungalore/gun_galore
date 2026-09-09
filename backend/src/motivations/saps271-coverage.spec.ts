import { MotivationLicenceType } from '@prisma/client';
import { percentOf, saps271Coverage } from './saps271-coverage';
import {
  OWNED_ROWS,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
  fieldsFor,
} from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE METER MUST NOT LIE, IN EITHER DIRECTION.
//
// It is on every page of the wizard, so it is the number an applicant uses to
// decide whether they are nearly done. Two ways it could mislead, and both are
// tested here:
//
//   TOO LOW  — counting questions that do not apply. Six "no" answers close
//              twenty-four follow-ups; five unused owned-firearm rows are not
//              thirty-five unanswered questions. An honest applicant would sit
//              near forty per cent for ever and conclude the thing is broken.
//   TOO HIGH — rounding 99.6 up to 100, or scoring a section somebody else
//              answers. A member who reads 100% stops looking.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;
const S13 = MotivationLicenceType.S13_SELF_DEFENCE;

const sectionOf = (c: ReturnType<typeof saps271Coverage>, id: string) =>
  c.sections.find((s) => s.id === id);

/**
 * The retired 271 opt-in.
 *
 * ⚠️ NO LONGER UN-HIDES ANYTHING. Until 2026-09-08 this answer was what
 * revealed every `formOnly` question — roughly forty-eight of them — and most
 * of the tests below used to spread it in for that reason. The SAPS 271 is no
 * longer something the applicant elects to receive (brief §2.5), so
 * `fill_saps271` is retired in motivation-fields.ts: `fieldsFor()` no longer
 * returns it at all, and every question it used to gate is simply asked of
 * everybody. This constant survives only for the one test below that proves
 * an OLD DRAFT's stray answer to a question we no longer ask still cannot move
 * the meter — see saps271-coverage.ts's own EXCLUDED_SECTIONS note.
 */
const OPTED_IN = { [SAPS271_OPT_KEY]: SAPS271_FILL };

describe('the section panel', () => {
  it('always shows the section applied for as done', () => {
    // It was chosen before the application existed. Leaving a gap where the
    // form has a section D reads as an omission.
    const d = sectionOf(saps271Coverage(S16, {}), 'D');
    expect(d).toMatchObject({ percent: 100, status: 'complete', applicable: 1 });
  });

  it('leaves out sections the licence type does not have', () => {
    // A section 13 applicant is not a dedicated shooter and must not be shown
    // an empty dedicated-status row to feel behind on.
    const s13 = saps271Coverage(S13, {});
    expect(sectionOf(s13, 'G4')).toBeUndefined();
    // Section 16 has it.
    expect(sectionOf(saps271Coverage(S16, {}), 'G4')).toBeDefined();
  });

  // ⚠️ THIS TEST EXISTED FOR TWO OF THE FIVE TYPES, AND A THIRD WAS BROKEN.
  // The G4 row's `from` list carried 'Experience' beside 'Dedicated status',
  // and section 15 — sold on the chooser as "for someone who hunts or shoots,
  // WITHOUT dedicated status" — has three Experience fields. So every step of
  // the operator's live section 15 read "G4 Dedicated status · 0% · 2 still
  // needed" on 2026-09-07, contradicting the licence type it belonged to.
  //
  // Nor is Experience a 271 question at all: items 55–60 are the association
  // block, and no Experience answer reaches any box on the form. It is the
  // motivation annexure's material.
  it('⚠️ shows no dedicated-status row on the type defined by not having it', () => {
    const s15 = saps271Coverage(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {});
    expect(sectionOf(s15, 'G4')).toBeUndefined();
  });

  // ⚠️ A COMPLETE SECTION THAT COULD NEVER READ 100%.
  //
  // applicableOwnedRows exists so an applicant who owns one firearm is not
  // scored against fourteen rows. The identical rule was never written for
  // associations: the registry carries three slots, none of their fields is
  // conditional, and the wizard hides slots two and three behind "add another
  // association" — so a member in ONE association was scored against six
  // questions they are never shown. Measured before the fix, with everything
  // they CAN see answered: sport 7 of 13 (54%), hunter 6 of 14 (43%).
  it('⚠️ lets a one-association applicant finish the dedicated-status section', () => {
    for (const t of [
      MotivationLicenceType.S16_DEDICATED_SPORT,
      MotivationLicenceType.S16_DEDICATED_HUNTER,
    ]) {
      const answers: Record<string, string> = {};
      for (const f of fieldsFor(t)) {
        if (f.section !== 'Dedicated status') continue;
        // Everything the single-association member is actually shown.
        if (/^association_[23]_/.test(f.key)) continue;
        answers[f.key] = f.kind === 'date' ? '2026-01-01' : 'x';
      }
      const g4 = sectionOf(saps271Coverage(t, answers), 'G4')!;
      expect(g4.percent).toBe(100);
      expect(g4.status).toBe('complete');
      expect(g4.missingRequired).toBe(0);
    }
  });

  it('counts a second association only once the member adds one', () => {
    const t = MotivationLicenceType.S16_DEDICATED_SPORT;
    const one = sectionOf(saps271Coverage(t, {}), 'G4')!;
    const two = sectionOf(
      saps271Coverage(t, { association_2_name: 'Bisley SA' }),
      'G4',
    )!;
    expect(two.applicable).toBeGreaterThan(one.applicable);
  });

  it('never files an experience answer under the association block', () => {
    for (const t of [
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      MotivationLicenceType.S16_DEDICATED_SPORT,
    ]) {
      const g4 = sectionOf(saps271Coverage(t, {}), 'G4');
      // Where the row survives it is the association block alone.
      if (g4) expect(g4.label).toBe('Dedicated status');
    }
  });

  it('never counts a stray answer to the retired 271 opt-in', () => {
    // ⚠️ NOT ABOUT SOMEBODY RAISING THEIR OWN SCORE ANY MORE — the question
    // is not asked, so nobody can tap it today. This is about an OLD DRAFT:
    // `fill_saps271` is retired, not deleted, and `sanitiseAnswers` still
    // accepts it so a draft saved before 2026-09-08 keeps loading. `fieldsFor`
    // no longer returns a field for it at all (see RETIRED_FIELDS in
    // motivation-fields.ts), so it must count for nothing either way — before
    // the retirement this held true because the answer un-hid no more
    // questions than answering it also cost, and now it holds for a simpler
    // reason: there is no registry field left for the key to match.
    const before = saps271Coverage(S16, {});
    const after = saps271Coverage(S16, { ...OPTED_IN });
    expect(after.answered).toBe(before.answered);
    expect(after.applicable).toBe(before.applicable);
  });

  it('gives every section a percentage and a required-count', () => {
    for (const s of saps271Coverage(S16, {}).sections) {
      expect(typeof s.percent).toBe('number');
      expect(s.percent!).toBeGreaterThanOrEqual(0);
      expect(s.percent!).toBeLessThanOrEqual(100);
      expect(typeof s.missingRequired).toBe('number');
      expect(s.answered).toBeLessThanOrEqual(s.applicable);
    }
  });
});

describe('what applies to this applicant', () => {
  it('does not count a history question’s follow-ups when the answer is no', () => {
    // ⚠️ THE HEADLINE RULE. History is 36 registry fields, 30 of them
    // conditional. Answering the six questions must not leave twenty-four
    // unanswerable ones dragging the section down.
    //
    // ⚠️ NO OPT-IN NEEDED TO SEE THIS SECTION AT ALL, SINCE 2026-09-08. These
    // six used to be `formOnly` themselves, hidden until `fill_saps271` was
    // answered; the whole 271 is unconditional now, so they are simply asked.
    const blankAnswers: Record<string, string> = {};
    // ⚠️ SIX QUESTIONS, AND history_negligence IS NOT ONE OF THEM HERE. It is
    // itself conditional — `showIf history_lost_stolen === 'Yes'` — so saying
    // no to the loss closes it too. The unconditional sixth is prior_refusals.
    const allNo = {
      history_conviction: 'No',
      history_pending_case: 'No',
      history_lost_stolen: 'No',
      history_declared_unfit: 'No',
      history_confiscated: 'No',
      prior_refusals: 'No',
    };

    const blank = sectionOf(saps271Coverage(S16, blankAnswers), 'H')!;
    const answered = sectionOf(saps271Coverage(S16, allNo), 'H')!;

    expect(answered.applicable).toBeLessThan(blank.applicable + 1);
    expect(answered.answered).toBeGreaterThan(0);
    // Every question that applies has been answered, so the section is done.
    expect(answered.answered).toBe(answered.applicable);
    expect(answered.percent).toBe(100);
    expect(answered.status).toBe('complete');
  });

  it('opens the follow-ups only for the question answered yes', () => {
    const one = {
      history_conviction: 'Yes',
      history_pending_case: 'No',
      history_lost_stolen: 'No',
      history_declared_unfit: 'No',
      history_confiscated: 'No',
      prior_refusals: 'No',
    };
    const allNo = { ...one, history_conviction: 'No' };

    const withYes = sectionOf(saps271Coverage(S16, one), 'H')!;
    const withNo = sectionOf(saps271Coverage(S16, allNo), 'H')!;

    expect(withYes.applicable).toBeGreaterThan(withNo.applicable);
    // And it is no longer complete — there are now details to give.
    expect(withYes.percent!).toBeLessThan(100);
  });
});

describe('the owned-firearm grid', () => {
  // ⚠️ NINE COLUMNS SINCE 2026-09-08, NOT EIGHT. `existing_firearm_N_primary_use`
  // joined as the tappable, profile-scoped sibling of `_use` (motivation-fields.ts,
  // brief §5.1) — same row, one more question the panel counts. It is unrelated
  // to the SAPS 271 opt-in this file otherwise exists to guard, but COLUMNS is
  // derived from this fixture rather than restated as a number, precisely so the
  // next field the registry adds updates this test instead of breaking it.
  const row = (n: number) => ({
    [`existing_firearm_${n}_make`]: 'CZ',
    [`existing_firearm_${n}_model`]: '550',
    [`existing_firearm_${n}_serial`]: 'C712884',
    [`existing_firearm_${n}_expiry`]: '2031-04-30',
    [`existing_firearm_${n}_type`]: 'Rifle',
    [`existing_firearm_${n}_calibre`]: '.308 Winchester',
    [`existing_firearm_${n}_use`]: 'Hunting',
    [`existing_firearm_${n}_primary_use`]: 'plains_game',
    [`existing_firearm_${n}_section_held`]: 'section_16',
    [`existing_firearm_${n}_licence_no`]: '4009117823',
  });
  const COLUMNS = Object.keys(row(1)).length;

  it('counts one row when nothing has been listed yet', () => {
    // Not zero — a section with nothing applicable would read as complete
    // when it has not been started. Not six — five untouched rows are not
    // thirty-five unanswered questions.
    const g2 = sectionOf(saps271Coverage(S16, {}), 'G2')!;
    expect(g2.applicable).toBeLessThan(12);
    expect(g2.answered).toBe(0);
    expect(g2.status).toBe('not-started');
    expect(g2.note).toMatch(/add the firearms/i);
  });

  it('counts only the rows in use, so one firearm is not a fraction of a section', () => {
    // ⚠️ THE FAILURE THIS RULE EXISTS FOR. isVisible says every owned-firearm
    // field applies, always — the registry's rows are fixed and none of them
    // is conditional. Counting them straight would peg an applicant who owns
    // one firearm near seven per cent for ever, and it got worse the day the
    // registry went from six rows to the form's own fourteen.
    const one = saps271Coverage(S16, { ...row(1) });
    const g2 = sectionOf(one, 'G2')!;

    expect(g2.answered).toBe(COLUMNS);
    // The row, plus overlap_justification.
    expect(g2.applicable).toBeLessThanOrEqual(COLUMNS + 1);
    expect(g2.percent!).toBeGreaterThan(80);
    expect(g2.note).toBe('1 firearm listed.');
  });

  it('grows the denominator only as rows are used', () => {
    const one = sectionOf(saps271Coverage(S16, { ...row(1) }), 'G2')!;
    const three = sectionOf(
      saps271Coverage(S16, { ...row(1), ...row(2), ...row(3) }),
      'G2',
    )!;

    expect(three.applicable).toBe(one.applicable + COLUMNS * 2);
    expect(three.answered).toBe(one.answered + COLUMNS * 2);
    expect(three.note).toBe('3 firearms listed.');
  });

  it('counts the seventh firearm and the fourteenth', () => {
    // ⚠️ THE ROWS THIS PANEL COULD NOT SEE. saps271-coverage.ts carried its own
    // `const OWNED_ROWS = 6` beside a comment claiming the paper form holds
    // 26. Both were wrong: item 2.1 is FOURTEEN rows, measured off the blank
    // form, and the registry now offers fourteen. While the copy stood, a
    // member who listed ten firearms was told the section was complete with
    // four of them uncounted — the meter's TOO HIGH failure, on the one
    // section where an undercount also understates a statutory precondition.
    let answers = {};
    for (let n = 1; n <= OWNED_ROWS; n++) answers = { ...answers, ...row(n) };
    const g2 = sectionOf(saps271Coverage(S16, answers), 'G2')!;

    expect(g2.note).toBe(`${OWNED_ROWS} firearms listed.`);
    expect(g2.answered).toBe(COLUMNS * OWNED_ROWS);
    // Every row in use is applicable, plus overlap_justification.
    expect(g2.applicable).toBeLessThanOrEqual(COLUMNS * OWNED_ROWS + 1);
  });

  it('treats a half-filled row as half-filled, not as absent', () => {
    const partial = sectionOf(
      saps271Coverage(S16, {
        existing_firearm_1_make: 'CZ 550',
        existing_firearm_1_calibre: '.308 Winchester',
      }),
      'G2',
    )!;
    expect(partial.answered).toBe(2);
    expect(partial.percent!).toBeGreaterThan(0);
    expect(partial.percent!).toBeLessThan(100);
    expect(partial.status).toBe('in-progress');
  });
});

describe('the current owner’s half', () => {
  it('is absent when nobody has been asked', () => {
    expect(sectionOf(saps271Coverage(S16, {}), 'F')).toBeUndefined();
    expect(
      sectionOf(saps271Coverage(S16, {}, { seller: { status: 'NONE' } }), 'F'),
    ).toBeUndefined();
  });

  it('carries a status and never a score', () => {
    // ⚠️ A PERCENTAGE HERE WOULD BE THE APPLICANT'S MARK FOR SOMEBODY ELSE'S
    // HOMEWORK. A 0% beside their own 80% reads as their failure.
    const f = sectionOf(
      saps271Coverage(S16, {}, { seller: { status: 'INVITED', name: 'Piet Malan' } }),
      'F',
    )!;
    expect(f.status).toBe('theirs');
    expect(f.applicable).toBe(0);
    // ⚠️ NULL, NOT 0. A zero beside the applicant's own score reads as their
    // failure, and a renderer will draw it without thinking.
    expect(f.percent).toBeNull();
    expect(f.note).toContain('Piet Malan');
    expect(f.note).toMatch(/nothing for you to do/i);
  });

  it('does not drag the overall number down while he has not answered', () => {
    const without = saps271Coverage(S16, { firearm_make: 'Marlin' });
    const with_ = saps271Coverage(
      S16,
      { firearm_make: 'Marlin' },
      { seller: { status: 'INVITED', name: 'Piet Malan' } },
    );
    expect(with_.percent).toBe(without.percent);
    expect(with_.applicable).toBe(without.applicable);
  });

  it('names the other route when he declines', () => {
    const f = sectionOf(
      saps271Coverage(S16, {}, { seller: { status: 'DECLINED', name: 'Piet' } }),
      'F',
    )!;
    expect(f.note).toMatch(/declined/i);
    expect(f.note).toMatch(/certified copy/i);
  });

  it('marks it done once he has signed', () => {
    const f = sectionOf(
      saps271Coverage(S16, {}, { seller: { status: 'COMPLETED', name: 'Piet' } }),
      'F',
    )!;
    expect(f.status).toBe('complete');
  });
});

describe('the arithmetic', () => {
  it('never rounds up to 100 with a question outstanding', () => {
    // ⚠️ 199 OF 200 IS 99.5, AND Math.round MAKES THAT 100. A member reading
    // 100% on a section stops looking at it, so the one question left would
    // never be found. Tested on the rule itself: no section is large enough
    // today to reach the rounding boundary, which is exactly why a test built
    // from a section would pass whether or not the guard existed.
    expect(percentOf(199, 200)).toBe(99);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(200, 200)).toBe(100);
  });

  it('never rounds down to 0 once something is answered', () => {
    // The mirror: work that was done must not read as none done.
    expect(percentOf(1, 200)).toBe(1);
    expect(percentOf(1, 1000)).toBe(1);
    expect(percentOf(0, 200)).toBe(0);
  });

  it('treats a section with nothing applicable as complete', () => {
    expect(percentOf(0, 0)).toBe(100);
  });

  it('does not round down to 0 in a real section either', () => {
    const e = sectionOf(saps271Coverage(S16, { firearm_make: 'Marlin' }), 'E')!;
    expect(e.answered).toBe(1);
    expect(e.percent!).toBeGreaterThan(0);
  });

  it('recounts the total rather than averaging the sections', () => {
    // ⚠️ AVERAGING WOULD WEIGHT A THREE-QUESTION SECTION LIKE A THIRTY-SIX
    // ONE, so answering the shortest section would move the headline number
    // further than answering the longest.
    const c = saps271Coverage(S16, { firearm_make: 'Marlin', firearm_calibre: '.45-70' });
    const summedApplicable = c.sections.reduce((n, s) => n + s.applicable, 0);
    const summedAnswered = c.sections.reduce((n, s) => n + s.answered, 0);
    expect(c.applicable).toBe(summedApplicable);
    expect(c.answered).toBe(summedAnswered);

    const average = Math.round(
      c.sections.reduce((n, s) => n + (s.percent ?? 0), 0) / c.sections.length,
    );
    expect(c.percent).not.toBe(average);
  });

  it('moves up as questions are answered, and never down', () => {
    const steps: Record<string, string>[] = [
      {},
      { firearm_make: 'Marlin' },
      { firearm_make: 'Marlin', firearm_calibre: '.45-70 Government' },
      { firearm_make: 'Marlin', firearm_calibre: '.45-70 Government', firearm_type: 'Rifle' },
    ];
    const percents = steps.map((a) => saps271Coverage(S16, a).percent);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
  });
});
