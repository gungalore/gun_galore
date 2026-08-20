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

  it('⚠️ NEVER FLAGS A THIN ANSWER — that is the writer to carry now', () => {
    // THIS REVERSES THE ORIGINAL DESIGN, deliberately. Thin answers and empty
    // optional fields used to become questions, and every failed gate cycle
    // backfilled three more — the operator opened his application to an
    // interrogation about his employer's address and the barrel length.
    // Nobody who pays for a motivation answers technical questionnaires: the
    // writer supplies the standard rationale; the applicant supplies
    // identity, paperwork and record. Only a MISSING REQUIRED answer — the
    // thing without which the document cannot be written — earns a question.
    const gaps = findGaps(T, { threat_circumstances: 'I feel unsafe.' });
    expect(gaps.find((x) => x.key === 'threat_circumstances')).toBeUndefined();
  });

  it('ignores even the gate own thin-field list', () => {
    // The gate may still USE thinFields for its verdict; Boet no longer turns
    // them into homework.
    const gaps = findGaps(T, { threat_circumstances: LONG }, {
      thinFields: ['threat_circumstances'],
    });
    expect(gaps.find((g) => g.key === 'threat_circumstances')).toBeUndefined();
  });

  it('never asks about an empty OPTIONAL field', () => {
    const keys = findGaps(T, {}).map((g) => g.key);
    expect(keys).not.toContain('employer_name');
    expect(keys).not.toContain('barrel_length');
  });
});

describe('the order questions are asked in', () => {
  it('asks ONLY for what blocks generation', () => {
    const gaps = findGaps(T, {});
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect(g.reason).toBe('missing_required');
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
    // And it is the ONLY optional field that can ever become a question:
    // why somebody wants a second firearm in the same class is knowledge
    // only they hold — a writer cannot supply it.
    expect(
      withOverlap.filter((x) => x.reason === 'missing_optional'),
    ).toHaveLength(0);
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
    // threat_circumstances is REQUIRED for a s13 pack, so leaving it out
    // entirely keeps it a gap — with prose in a sibling answer proving the
    // brief never carries what an applicant wrote anywhere.
    const secret = 'I was robbed at gunpoint outside 12 Kerk Street on 3 March.';
    const gaps = findGaps(T, { daily_movements: secret });
    const brief = gapBrief(gaps);
    const serialised = JSON.stringify(brief);

    expect(serialised).not.toContain('Kerk Street');
    expect(serialised).not.toContain('robbed');
    expect(serialised).toContain('threat_circumstances');
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

  it('phrases a missing required answer as a plain ask', () => {
    // Thin answers no longer produce questions at all — the writer carries
    // them — so the fallback only ever words a MISSING required field.
    const gaps = findGaps(T, {});
    expect(gaps.length).toBeGreaterThan(0);
    expect(fallbackQuestion(gaps[0])).toBeTruthy();
  });

  it('never promises an outcome', () => {
    const text = findGaps(T, {}).map(fallbackQuestion).join(' ').toLowerCase();
    for (const banned of ['approv', 'chance', 'guarantee', 'likely', 'success']) {
      expect(text).not.toContain(banned);
    }
  });
});
