import { MotivationLicenceType } from '@prisma/client';
import { percentOf, saps271Coverage } from './saps271-coverage';
import { SAPS271_FILL, SAPS271_OPT_KEY } from './motivation-fields';

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

/** The 271 opt-in, which is what un-hides every formOnly question. */
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

  it('never counts the 271 opt-in as an application question', () => {
    // Otherwise a member raises their own completeness by picking a setting.
    const before = saps271Coverage(S16, {});
    const after = saps271Coverage(S16, { ...OPTED_IN });
    expect(after.answered).toBe(before.answered);
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
    const opted = { ...OPTED_IN };
    // ⚠️ SIX QUESTIONS, AND history_negligence IS NOT ONE OF THEM HERE. It is
    // itself conditional — `showIf history_lost_stolen === 'Yes'` — so saying
    // no to the loss closes it too. The unconditional sixth is prior_refusals.
    const allNo = {
      ...opted,
      history_conviction: 'No',
      history_pending_case: 'No',
      history_lost_stolen: 'No',
      history_declared_unfit: 'No',
      history_confiscated: 'No',
      prior_refusals: 'No',
    };

    const blank = sectionOf(saps271Coverage(S16, opted), 'H')!;
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
      ...OPTED_IN,
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

  it('hides everything that exists only for the 271 until it is opted into', () => {
    const out = saps271Coverage(S16, {});
    const withForm = saps271Coverage(S16, { ...OPTED_IN });
    expect(withForm.applicable).toBeGreaterThan(out.applicable);
  });
});

describe('the owned-firearm grid', () => {
  const row = (n: number) => ({
    [`existing_firearm_${n}_make`]: 'CZ 550',
    [`existing_firearm_${n}_calibre`]: '.308 Winchester',
    [`existing_firearm_${n}_type`]: 'Rifle',
    [`existing_firearm_${n}_use`]: 'Hunting',
    [`existing_firearm_${n}_barrel_serial`]: 'C712884',
    [`existing_firearm_${n}_frame_serial`]: 'NONE',
    [`existing_firearm_${n}_licence_no`]: '4009117823',
  });

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

  it('counts only the rows in use, so one firearm is not a seventh of a section', () => {
    // ⚠️ THE FAILURE THIS RULE EXISTS FOR. isVisible says all forty-two
    // owned-firearm fields apply, always — the registry has six fixed rows and
    // none of them is conditional. Counting them straight would peg an
    // applicant who owns one firearm near fourteen per cent for ever.
    const one = saps271Coverage(S16, { ...row(1) });
    const g2 = sectionOf(one, 'G2')!;

    expect(g2.answered).toBe(7);
    expect(g2.applicable).toBeLessThanOrEqual(8); // the row, plus overlap_justification
    expect(g2.percent!).toBeGreaterThan(80);
    expect(g2.note).toBe('1 firearm listed.');
  });

  it('grows the denominator only as rows are used', () => {
    const one = sectionOf(saps271Coverage(S16, { ...row(1) }), 'G2')!;
    const three = sectionOf(
      saps271Coverage(S16, { ...row(1), ...row(2), ...row(3) }),
      'G2',
    )!;

    expect(three.applicable).toBe(one.applicable + 14);
    expect(three.answered).toBe(one.answered + 14);
    expect(three.note).toBe('3 firearms listed.');
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
