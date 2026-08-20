import { MotivationLicenceType } from '@prisma/client';
import { fieldsFor, isVisible } from './motivation-fields';
import {
  FOLLOW_UP_BATCH,
  fallbackQuestion,
  findGaps,
  gapBrief,
} from './motivation-gaps';

// This is the free half of the interview: code finds the gaps, Claude only
// words the questions. So the things worth pinning are that it finds the right
// gaps, in the right order, and that the brief it hands over carries NO prose
// from the applicant.

const T = MotivationLicenceType.S13_SELF_DEFENCE;
const LONG = 'x'.repeat(400);

describe('finding the gaps', () => {
  it('reports every required field the interview is responsible for', () => {
    // Derived, not hand-listed: "required, applies right now, and not a
    // form-only box" is exactly the set the interview owns, and writing the
    // exclusions out by hand just encodes today's registry into the test.
    const keys = findGaps(T, {}).map((g) => g.key);
    const owed = fieldsFor(T)
      .filter((f) => f.required && !f.formOnly && isVisible(f, {}))
      .map((f) => f.key);

    expect(owed.length).toBeGreaterThan(3);
    for (const k of owed) expect(keys).toContain(k);
    // …and it claims nothing it does not own.
    const formOnly = fieldsFor(T).filter((f) => f.formOnly).map((f) => f.key);
    for (const k of formOnly) expect(keys).not.toContain(k);
  });

  it('does not ask about a conditional field that does not apply', () => {
    // Asking a single applicant for their spouse's ID is how a wizard loses
    // someone.
    const keys = findGaps(T, { marital_status: 'Single' }).map((g) => g.key);
    expect(keys).not.toContain('spouse_name');
    expect(keys).not.toContain('history_conviction_detail');
  });

  it('never asks an interview question about a form-only or transcribed box', () => {
    // Nobody needs a warmly-phrased question about their postal code.
    const keys = findGaps(T, {}).map((g) => g.key);
    for (const k of [
      'residential_postal_code',
      'home_dialling_code',
      'cellphone',
      'history_conviction',
      'existing_firearm_1_calibre',
    ]) {
      expect(keys).not.toContain(k);
    }
  });

  it('flags a long answer that is barely there', () => {
    const gaps = findGaps(T, { threat_circumstances: 'I feel unsafe.' });
    const g = gaps.find((x) => x.key === 'threat_circumstances')!;
    expect(g.reason).toBe('thin');
  });

  it('leaves a substantial answer alone', () => {
    const keys = findGaps(T, { threat_circumstances: LONG }).map((g) => g.key);
    expect(keys).not.toContain('threat_circumstances');
  });

  it("respects the gate's own thin-field list even on a long answer", () => {
    // The gate weighs quality with a model; the character floor is only the
    // cheap catch. A gate finding must outrank the floor's opinion.
    const gaps = findGaps(T, { threat_circumstances: LONG }, {
      thinFields: ['threat_circumstances'],
    });
    expect(gaps.find((g) => g.key === 'threat_circumstances')?.reason).toBe('thin');
  });
});

describe('the order questions are asked in', () => {
  it('puts what blocks generation before what merely improves it', () => {
    const gaps = findGaps(T, {});
    const ranks = gaps.map((g) => g.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(gaps[0].reason).toBe('missing_required');
  });

  it('promotes the overlap justification only when there is an overlap', () => {
    // Optional in the registry because most applicants never need it. When the
    // overlap check finds a firearm in the same class it is not optional in
    // practice — the application is refusable without it.
    const without = findGaps(T, {}).map((g) => g.key);
    expect(without).not.toContain('overlap_justification');

    const withOverlap = findGaps(T, {}, { overlapNeedsJustification: true });
    const g = withOverlap.find((x) => x.key === 'overlap_justification')!;
    expect(g.reason).toBe('overlap');
    // Ahead of the merely-nice-to-have fields.
    const optional = withOverlap.filter((x) => x.reason === 'missing_optional');
    for (const o of optional) expect(g.rank).toBeLessThan(o.rank);
  });

  it('asks three at a time', () => {
    // A wall of questions after a failed gate reads as punishment.
    expect(FOLLOW_UP_BATCH).toBe(3);
    expect(findGaps(T, {}).slice(0, FOLLOW_UP_BATCH)).toHaveLength(3);
  });
});

describe('the brief handed to Claude', () => {
  it('carries the label and the hint, and NOT what the applicant wrote', () => {
    // The follow-up prompt exists to WORD a question. It has no business
    // seeing someone's security circumstances to do that, and the cheapest way
    // to keep them out of it is to never send them.
    const secret = 'I was robbed at gunpoint outside 12 Kerk Street on 3 March.';
    const gaps = findGaps(T, { threat_circumstances: secret });
    const brief = gapBrief(gaps);
    const serialised = JSON.stringify(brief);

    expect(serialised).not.toContain('Kerk Street');
    expect(serialised).not.toContain('robbed');
    expect(serialised).toContain('threat_circumstances');
    // Length is summarised instead.
    const entry = brief.find((b) => b.key === 'threat_circumstances')!;
    expect(entry.wordsSoFar).toBeGreaterThan(0);
  });

  it('reports zero words for a field never answered', () => {
    const brief = gapBrief(findGaps(T, {}));
    expect(brief.every((b) => b.wordsSoFar === 0)).toBe(true);
  });

  it('is one entry per gap, in the same order', () => {
    const gaps = findGaps(T, {});
    const brief = gapBrief(gaps);
    expect(brief.map((b) => b.key)).toEqual(gaps.map((g) => g.key));
  });
});

describe('the free fallback', () => {
  it('produces a usable question without calling anything', () => {
    // An applicant must never be stuck because a model call failed.
    const gaps = findGaps(T, {});
    for (const g of gaps) {
      const q = fallbackQuestion(g);
      expect(q.length).toBeGreaterThan(10);
      expect(q).toMatch(/\?/);
    }
  });

  it('asks for MORE when the answer was thin, rather than starting over', () => {
    const gaps = findGaps(T, { threat_circumstances: 'Unsafe area.' });
    const g = gaps.find((x) => x.key === 'threat_circumstances')!;
    expect(fallbackQuestion(g)).toMatch(/a bit more/i);
  });

  it('never promises an outcome', () => {
    const text = findGaps(T, {}).map(fallbackQuestion).join(' ').toLowerCase();
    for (const banned of ['approv', 'chance', 'guarantee', 'likely', 'success']) {
      expect(text).not.toContain(banned);
    }
  });
});
