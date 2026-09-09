import { MotivationLicenceType } from '@prisma/client';
import {
  planFor,
  headingFor,
  expectedHeadings,
  followsPlan,
  fingerprint,
  similarity,
  maxSimilarity,
  SIMILARITY_REGENERATE_THRESHOLD,
  type PlanOptions,
  type SectionId,
} from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// THE FIXED SKELETON, AND WHAT IS LEFT OF THE DETECTOR.
//
// ⚠️ THIS FILE USED TO TEST THE OPPOSITE PROPERTY. It asserted that the plan
// varied across seeds — different headings, a real "plan space", permuting
// pairs — because a CFR reviewer recognising our shape was treated as the
// existential risk. MOTIVATION-GUIDE-BOOK failure mode 9 records what that
// produced, and Part 4.2 and Part 7.1 replace it: twelve numbered headings,
// the same ones every time, because a DFO compares the facts to the annexures
// rather than one applicant's letter to another's, and a consistent spine
// makes that faster.
//
// So what is proven here is the reverse of what used to be: the plan is a pure
// function of the licence type and four facts about the applicant; the
// headings are word-for-word the book's; the numbers do not re-sequence when a
// section is omitted; and each section of the Act omits exactly the headings
// its chapter says it does.
//
// The sameness detector survives as a MEASUREMENT — see the block above it.
// ────────────────────────────────────────────────────────────────────

const ALL_TYPES = Object.values(MotivationLicenceType);

/** Everything on, so a plan carries every heading its type can carry. */
const FULL: PlanOptions = {
  holdsFirearms: true,
  hasRecord: true,
  isAssociationMember: true,
};

const idsFor = (type: MotivationLicenceType, opts: PlanOptions = FULL) =>
  planFor(type, 1, opts).sections.map((s) => s.id);

const numbersOf = (type: MotivationLicenceType, opts: PlanOptions = FULL) =>
  planFor(type, 1, opts).sections.map((s) => Number(s.heading.split('.')[0]));

describe('the fixed skeleton', () => {
  it('is a pure function of the type and the options — the seed does nothing', () => {
    // The seed is kept and stored because it ties a filed document to the row
    // that produced it. It is no longer an input to the shape.
    for (const type of ALL_TYPES) {
      const a = planFor(type, 1, FULL);
      const b = planFor(type, 2 ** 31 - 1, FULL);
      expect(expectedHeadings(a)).toEqual(expectedHeadings(b));
      expect(a.sections.map((s) => s.paragraphs)).toEqual(
        b.sections.map((s) => s.paragraphs),
      );
      expect(a.seed).toBe(1);
      expect(b.seed).toBe(2 ** 31 - 1);
    }
  });

  it('always opens on the introduction and closes on the declaration', () => {
    for (const type of ALL_TYPES) {
      const ids = idsFor(type);
      expect(ids[0]).toBe('introduction');
      expect(ids[ids.length - 1]).toBe('conclusion');
    }
  });

  it('runs in ascending heading number, with no section twice', () => {
    for (const type of ALL_TYPES) {
      const nums = numbersOf(type);
      expect(nums).toEqual([...nums].sort((a, b) => a - b));
      expect(new Set(nums).size).toBe(nums.length);
      expect(new Set(idsFor(type)).size).toBe(idsFor(type).length);
    }
  });

  it('⚠️ DOES NOT RE-SEQUENCE THE NUMBERS WHEN A SECTION IS OMITTED', () => {
    // The gaps are the point. A section 15 with nothing held and nothing to
    // declare runs 1, 3, 5, 7, 9, 11, 12 — a DFO who reads these packs sees at
    // a glance that heading 2 is a self-defence heading and that there was
    // nothing to declare, rather than counting to work out which spine this is.
    expect(numbersOf(MotivationLicenceType.S15_OCCASIONAL_HUNTER, {})).toEqual([
      1, 3, 5, 7, 9, 11, 12,
    ]);
    expect(numbersOf(MotivationLicenceType.S13_SELF_DEFENCE, {})).toEqual([
      1, 2, 3, 4, 5, 7, 9, 11, 12,
    ]);
  });

  it('numbers and titles are the book’s, word for word', () => {
    expect(headingFor(MotivationLicenceType.S13_SELF_DEFENCE, 'introduction')).toBe(
      '1. Introduction',
    );
    expect(
      headingFor(MotivationLicenceType.S13_SELF_DEFENCE, 'personal_circumstances'),
    ).toBe('2. My circumstances');
    expect(headingFor(MotivationLicenceType.S13_SELF_DEFENCE, 'the_threat')).toBe(
      '3. Why I need a firearm for self-defence',
    );
    expect(
      headingFor(MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE, 'the_threat'),
    ).toBe('3. Why a section 13 firearm will not provide sufficient protection');
    expect(
      headingFor(MotivationLicenceType.S15_OCCASIONAL_HUNTER, 'the_quarry'),
    ).toBe('3. My hunting');
    expect(
      headingFor(MotivationLicenceType.S16_DEDICATED_SPORT, 'the_discipline'),
    ).toBe('3. My sport shooting');
    expect(headingFor(MotivationLicenceType.S24_RENEWAL, 'use_since_licensing')).toBe(
      '3. How I have used this firearm since it was licensed',
    );
    expect(headingFor(MotivationLicenceType.S13_SELF_DEFENCE, 'held_firearms')).toBe(
      '6. Firearms already licensed to me',
    );
    expect(headingFor(MotivationLicenceType.S13_SELF_DEFENCE, 'conclusion')).toBe(
      '12. Declaration and request',
    );
  });

  it('⚠️ NEVER ENDS A HEADING IN A COLON — Part 7.1', () => {
    // The colon was how the PDF renderer told a heading from a paragraph, and
    // it is now the number that does that. A colon creeping back would print
    // "3. My hunting:" and read as a chat transcript rather than a document.
    for (const type of ALL_TYPES) {
      for (const h of expectedHeadings(planFor(type, 1, FULL))) {
        expect(h).not.toMatch(/:\s*$/);
        expect(h).toMatch(/^\d{1,2}\. \S/);
      }
    }
  });

  it('names the section it is quoting, for every type', () => {
    const section: Record<MotivationLicenceType, string> = {
      S13_SELF_DEFENCE: '11. Section 13 applied to my application',
      S14_RESTRICTED_SELF_DEFENCE: '11. Section 14 applied to my application',
      S15_OCCASIONAL_HUNTER: '11. Section 15 applied to my application',
      S16_DEDICATED_HUNTER: '11. Section 16 applied to my application',
      S16_DEDICATED_SPORT: '11. Section 16 applied to my application',
      S24_RENEWAL: '11. Section 24 applied to my application',
    };
    for (const type of ALL_TYPES) {
      expect(headingFor(type, 'statutory_application')).toBe(section[type]);
    }
  });

  it('the introduction and the declaration are one paragraph each', () => {
    for (const type of ALL_TYPES) {
      const plan = planFor(type, 1, FULL);
      const byId = new Map(plan.sections.map((s) => [s.id, s.paragraphs]));
      expect(byId.get('introduction')).toBe(1);
      expect(byId.get('conclusion')).toBe(1);
    }
  });

  it('the opening, closing and cadence are fixed', () => {
    for (const type of ALL_TYPES) {
      const plan = planFor(type, 99, FULL);
      expect(plan.opening).toBe('purpose_first');
      expect(plan.closing).toBe('declaration');
      expect(plan.cadence).toBe('plain');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// WHICH HEADINGS A SECTION OF THE ACT CARRIES AT ALL.
//
// Book Part 5. Headings 2 and 4 are the self-defence pair — circumstances and
// what the applicant already does about the risk — and every other chapter
// omits them. Headings 6, 8 and 10 turn on the applicant's own answers.
// ────────────────────────────────────────────────────────────────────

describe('what each section of the Act omits', () => {
  it('gives circumstances and existing measures to s13 and s14 only', () => {
    for (const type of ALL_TYPES) {
      const ids = idsFor(type);
      const selfDefence =
        type === MotivationLicenceType.S13_SELF_DEFENCE ||
        type === MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE;
      expect(ids.includes('personal_circumstances')).toBe(selfDefence);
      expect(ids.includes('existing_measures')).toBe(selfDefence);
    }
  });

  it('gives every type exactly one purpose section', () => {
    const purposes: SectionId[] = [
      'the_threat',
      'the_quarry',
      'the_discipline',
      'use_since_licensing',
    ];
    for (const type of ALL_TYPES) {
      const ids = idsFor(type);
      expect(ids.filter((id) => purposes.includes(id))).toHaveLength(1);
    }
  });

  it('⚠️ GIVES A RENEWAL ONE TOO, which it used to have none of', () => {
    // Failure mode 6: treating a renewal as sectionless so it cannot argue
    // s24(3). The renewal's purpose section is continuity — what has been done
    // with the firearm since it was licensed — not a fresh need argument.
    expect(idsFor(MotivationLicenceType.S24_RENEWAL)).toContain(
      'use_since_licensing',
    );
  });

  it('gives a self-defence applicant the threat and never a hunting section', () => {
    for (const type of [
      MotivationLicenceType.S13_SELF_DEFENCE,
      MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE,
    ]) {
      const ids = idsFor(type);
      expect(ids).toContain('the_threat');
      expect(ids).not.toContain('the_quarry');
      expect(ids).not.toContain('the_discipline');
      expect(ids).not.toContain('association');
    }
  });

  it('always states the purpose before justifying the firearm', () => {
    // The pair: the purpose section defines the requirement, the firearm
    // section answers it. Run the other way round, every "which is why this
    // rifle suits it" points at a section the reader has not reached.
    for (const type of ALL_TYPES) {
      const ids = idsFor(type);
      const purpose = ids.findIndex((id) =>
        ['the_threat', 'the_quarry', 'the_discipline', 'use_since_licensing'].includes(
          id,
        ),
      );
      expect(purpose).toBeGreaterThan(-1);
      expect(purpose).toBeLessThan(ids.indexOf('the_firearm'));
    }
  });

  it('⚠️ HAS NO CALIBRE SECTION ANYWHERE — it is folded into the firearm', () => {
    // It had a heading of its own and what filled it was a cartridge essay
    // that reached the applicant late or never (failure mode 11). The book
    // gives it two or three sentences inside heading 5.
    for (const type of ALL_TYPES) {
      expect(idsFor(type).join(' ')).not.toContain('calibre');
    }
  });
});

describe('the three headings the applicant’s own answers decide', () => {
  it('drops the battery on a first application and prints it otherwise', () => {
    for (const type of ALL_TYPES) {
      expect(idsFor(type, { ...FULL, holdsFirearms: false })).not.toContain(
        'held_firearms',
      );
      expect(idsFor(type, { ...FULL, holdsFirearms: true })).toContain(
        'held_firearms',
      );
    }
  });

  it('⚠️ NO LONGER WAITS FOR A SAME-CLASS OVERLAP', () => {
    // It used to appear only where the applicant held a firearm in the same
    // class as the one applied for. The DFO reads the licence record against
    // the request whether or not two entries happen to be the same class, so
    // every held firearm now gets a row and a sentence.
    const ids = idsFor(MotivationLicenceType.S16_DEDICATED_SPORT, {
      holdsFirearms: true,
    });
    expect(ids).toContain('held_firearms');
  });

  it('drops the record unless something is declared', () => {
    for (const type of ALL_TYPES) {
      expect(idsFor(type, { ...FULL, hasRecord: false })).not.toContain(
        'compliance_history',
      );
      expect(idsFor(type, { ...FULL, hasRecord: true })).toContain(
        'compliance_history',
      );
    }
  });

  it('gives section 16 the association section whether or not the flag is set', () => {
    // Dedicated status IS the section, so the heading is never conditional on
    // the two section 16 routes.
    for (const type of [
      MotivationLicenceType.S16_DEDICATED_HUNTER,
      MotivationLicenceType.S16_DEDICATED_SPORT,
    ]) {
      expect(idsFor(type, { isAssociationMember: false })).toContain('association');
    }
  });

  it('gives a section 15 the association section only where there is one', () => {
    const s15 = MotivationLicenceType.S15_OCCASIONAL_HUNTER;
    expect(idsFor(s15, { isAssociationMember: false })).not.toContain('association');
    expect(idsFor(s15, { isAssociationMember: true })).toContain('association');
    // ⚠️ AND IT NAMES MEMBERSHIP, NEVER DEDICATED STATUS. The Act still
    // defines an occasional hunter as somebody who is NOT a member of an
    // accredited association, so a section 15 claiming dedicated status argues
    // itself out of the section it is applying under.
    expect(headingFor(s15, 'association')).toBe('8. Association membership');
    expect(headingFor(MotivationLicenceType.S16_DEDICATED_HUNTER, 'association')).toBe(
      '8. Association membership and dedicated status',
    );
  });
});

describe('the section 15 variant', () => {
  const s15 = MotivationLicenceType.S15_OCCASIONAL_HUNTER;

  it('gives a hunter the quarry and a sport shooter the discipline', () => {
    expect(idsFor(s15, { purpose: 'hunting' })).toContain('the_quarry');
    expect(idsFor(s15, { purpose: 'hunting' })).not.toContain('the_discipline');
    expect(idsFor(s15, { purpose: 'sport' })).toContain('the_discipline');
    expect(idsFor(s15, { purpose: 'sport' })).not.toContain('the_quarry');
  });

  it('defaults to hunting when nothing says otherwise', () => {
    expect(idsFor(s15, {})).toContain('the_quarry');
  });

  it('⚠️ SWAPS NOBODY ELSE’S PURPOSE SECTION', () => {
    // The option is a section 15 answer. A dedicated sports shooter asked for
    // `purpose: 'hunting'` still gets the discipline, because their section is
    // what decides it.
    expect(
      idsFor(MotivationLicenceType.S16_DEDICATED_SPORT, { purpose: 'hunting' }),
    ).toContain('the_discipline');
    expect(
      idsFor(MotivationLicenceType.S13_SELF_DEFENCE, { purpose: 'sport' }),
    ).toContain('the_threat');
  });
});

describe('paragraph budgets', () => {
  const budget = (type: MotivationLicenceType, id: SectionId) =>
    planFor(type, 1, FULL).sections.find((s) => s.id === id)?.paragraphs;

  it('⚠️ GIVES A SECTION 13 FIREARM SECTION ONE PARAGRAPH', () => {
    // Given two to four it filled them with a catalogue — short recoil,
    // tilting barrel, polymer frame. Book Part 5.1 brief 5: one paragraph, at
    // most sixty words, four facts. The room WAS the instruction.
    expect(budget(MotivationLicenceType.S13_SELF_DEFENCE, 'the_firearm')).toBe(1);
  });

  it('gives a section 14 more room where section K’s facts have to appear', () => {
    expect(
      budget(MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE, 'personal_circumstances'),
    ).toBe(4);
    expect(
      budget(MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE, 'the_threat'),
    ).toBe(4);
  });

  it('gives the statutory section room to quote AND apply', () => {
    // Quote an element, answer it with a fact, then the next. Squeezed to one
    // it reverts to regulation pasted in with nothing beneath it.
    for (const type of ALL_TYPES) {
      expect(budget(type, 'statutory_application')).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('plan verification', () => {
  const plan = planFor(MotivationLicenceType.S16_DEDICATED_HUNTER, 42, FULL);
  const docFromPlan = (headings: string[]) =>
    headings.map((h) => `${h}\n\nSome text for this section.`).join('\n\n');

  it('accepts a document that follows the plan', () => {
    expect(followsPlan(docFromPlan(expectedHeadings(plan)), plan).ok).toBe(true);
  });

  it('catches a missing section', () => {
    const short = expectedHeadings(plan).slice(1);
    const out = followsPlan(docFromPlan(short), plan);
    expect(out.ok).toBe(false);
    expect(out.missing).toHaveLength(1);
  });

  it('catches sections in the wrong order', () => {
    const swapped = [...expectedHeadings(plan)];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    const out = followsPlan(docFromPlan(swapped), plan);
    expect(out.ok).toBe(false);
    expect(out.outOfOrder).toBe(true);
  });

  it('is case-insensitive about headings but not about their presence', () => {
    const shouted = expectedHeadings(plan).map((h) => h.toUpperCase());
    expect(followsPlan(docFromPlan(shouted), plan).ok).toBe(true);
  });

  it('⚠️ CATCHES A RENUMBERED HEADING', () => {
    // The writer is told not to renumber, and this is what happens when it
    // does anyway: "1. Introduction, 2. My hunting" instead of "1., 3.".
    const renumbered = expectedHeadings(plan).map((h, i) =>
      h.replace(/^\d{1,2}\./, `${i + 1}.`),
    );
    expect(followsPlan(docFromPlan(renumbered), plan).ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE SAMENESS DETECTOR — a measurement, not a trigger.
//
// ⚠️ IT NO LONGER REGENERATES ANYTHING. With the skeleton fixed, a fresh seed
// produces the same plan, so spending a second model call on a high score buys
// nothing. Two motivations of one section scoring alike is now the design
// working. What a score at the ceiling still says is that the PROSE is
// repeating — that the applicant's own facts stopped reaching the writer — and
// that raises an admin card instead.
// ────────────────────────────────────────────────────────────────────

describe('the sameness detector', () => {
  const DOC_A = [
    '1. Introduction',
    'I am applying for a licence in terms of section 16 of the Act. I have hunted for eleven years.',
    '7. My competency and training',
    'I completed my competency in 2018. I hunt plains game in the Free State each winter.',
    '9. Safe storage and transport',
    'The firearm will be kept in a safe bolted to a brick wall. Nobody else has the code.',
  ].join('\n\n');

  // Same SHAPE, completely different person, different facts and names.
  const DOC_B_SAME_SHAPE = [
    '1. Introduction',
    'I am applying for a licence in terms of section 16 of the Act. I have hunted for four years.',
    '7. My competency and training',
    'I completed my competency in 2022. I hunt plains game in Limpopo each autumn.',
    '9. Safe storage and transport',
    'The firearm will be kept in a safe bolted to a concrete wall. Nobody else has the code.',
  ].join('\n\n');

  // Genuinely different document: different headings, different rhythm.
  const DOC_C_DIFFERENT = [
    '3. Why I need a firearm for self-defence',
    'My work takes me onto isolated farms after dark, often carrying cash.',
    '2. My circumstances',
    'Two armed robberies happened on my route during the past year.',
    '9. Safe storage and transport',
    'A wall-mounted safe in the main bedroom will hold it when it is not carried.',
  ].join('\n\n');

  it('still reads a numbered heading as a heading', () => {
    // ⚠️ THE MARKER USED TO BE THE TRAILING COLON. Left alone when the colon
    // went, this classified every heading as prose and the detector silently
    // stopped measuring structure at all — while still returning a number.
    expect(fingerprint('9. Safe storage and transport\n\nA safe.').length).toBe(0);
    const shape = fingerprint(DOC_A).length;
    expect(shape).toBeGreaterThan(0);
  });

  it('scores two same-shaped documents high even with different content', () => {
    const s = similarity(fingerprint(DOC_A), fingerprint(DOC_B_SAME_SHAPE));
    expect(s).toBeGreaterThan(SIMILARITY_REGENERATE_THRESHOLD);
  });

  it('scores genuinely different documents low', () => {
    const s = similarity(fingerprint(DOC_A), fingerprint(DOC_C_DIFFERENT));
    expect(s).toBeLessThan(SIMILARITY_REGENERATE_THRESHOLD);
  });

  it('scores a document against itself as 1', () => {
    const fp = fingerprint(DOC_A);
    expect(similarity(fp, fp)).toBe(1);
  });

  it('is not fooled by swapping names and numbers alone', () => {
    const renamed = DOC_A.replace(/Free State/g, 'Mpumalanga')
      .replace(/2018/g, '2007')
      .replace(/eleven/g, 'six');
    expect(similarity(fingerprint(DOC_A), fingerprint(renamed))).toBe(1);
  });

  it('produces hashes, never the applicant own words', () => {
    // These land in a queryable column, so even stripped phrasing must not be
    // recoverable from them.
    const fp = fingerprint(DOC_A);
    expect(fp.length).toBeGreaterThan(0);
    for (const shingle of fp) expect(shingle).toMatch(/^[0-9a-f]{12}$/);
    expect(fp.join(' ')).not.toContain('hunted');
  });

  it('handles empty and tiny documents without throwing', () => {
    expect(fingerprint('')).toEqual([]);
    expect(fingerprint('Hi.')).toEqual([]);
    expect(similarity([], [])).toBe(1);
    expect(similarity(fingerprint(DOC_A), [])).toBe(0);
  });

  it('maxSimilarity finds the worst match in the corpus', () => {
    const worst = maxSimilarity(fingerprint(DOC_A), [
      fingerprint(DOC_C_DIFFERENT),
      fingerprint(DOC_B_SAME_SHAPE),
      fingerprint(DOC_C_DIFFERENT),
    ]);
    expect(worst).toBeGreaterThan(SIMILARITY_REGENERATE_THRESHOLD);
    expect(maxSimilarity(fingerprint(DOC_A), [])).toBe(0);
  });

  it('the threshold stays loose', () => {
    // Motivations for the same section share vocabulary by necessity — there
    // are only so many ways to describe a safe bolted to a wall — and now
    // share their headings by design. It is an alerting threshold, so a tight
    // one would raise a card on every document.
    expect(SIMILARITY_REGENERATE_THRESHOLD).toBeGreaterThan(0.4);
    expect(SIMILARITY_REGENERATE_THRESHOLD).toBeLessThan(0.8);
  });
});

// ── continuity for a returning applicant ────────────────────────────
//
// Operator, 2026-08-18: keep earlier motivations so a repeat applicant gets the
// same storyline. That makes the sameness engine's scope load-bearing, so it is
// asserted here rather than left to the query.

describe('who the sameness engine is actually guarding against', () => {
  it('treats two documents about one life as legitimately alike', () => {
    // The engine exists so nobody at the CFR meets a flood of near-identical
    // documents from DIFFERENT people. A second application by the SAME person
    // describes the same commute, the same premises and the same history — it
    // SHOULD read alike, and forcing it apart would manufacture exactly the
    // contradiction a DFO looks for.
    //
    // The guard is the userId exclusion in recentFingerprints; this pins the
    // reason it has to be there, by showing what the raw score would say.
    const first = fingerprint(
      'Background\nMy circumstances\nThe firearm\nStorage\nConclusion',
    );
    const second = fingerprint(
      'Background\nMy circumstances\nThe firearm\nStorage\nConclusion',
    );
    expect(similarity(first, second)).toBeGreaterThan(
      SIMILARITY_REGENERATE_THRESHOLD,
    );
  });
});
