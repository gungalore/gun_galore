import { MotivationLicenceType } from '@prisma/client';
import {
  planFor,
  expectedHeadings,
  followsPlan,
  fingerprint,
  similarity,
  maxSimilarity,
  SIMILARITY_REGENERATE_THRESHOLD,
} from './motivation-structure';

// This engine exists because full automation makes one failure mode
// existential: if every motivation has the same shape, a CFR reviewer
// eventually notices, and when they do, every document we have produced is
// tainted — including ones already submitted by paying customers.
//
// So the properties under test are: the plan is deterministic (an admin can
// reproduce and explain any document), it genuinely varies across seeds, it
// never varies where variation would damage the document, and the detector
// can tell "same shape, different people" from "genuinely different".

const ALL_TYPES = Object.values(MotivationLicenceType);

describe('structure planning', () => {
  it('is deterministic — the same seed always gives the same plan', () => {
    for (const t of ALL_TYPES) {
      expect(planFor(t, 12345)).toEqual(planFor(t, 12345));
    }
  });

  it('different seeds give different plans', () => {
    const a = planFor(MotivationLicenceType.S13_SELF_DEFENCE, 1);
    const b = planFor(MotivationLicenceType.S13_SELF_DEFENCE, 2);
    expect(a).not.toEqual(b);
  });

  it('always opens with the introduction and closes with the conclusion', () => {
    // Variation is only allowed where it does not damage the document. A
    // motivation that does not begin by saying what it applies for, or ends
    // without an undertaking, reads as broken however novel its middle is.
    for (const t of ALL_TYPES) {
      for (let seed = 0; seed < 200; seed++) {
        const plan = planFor(t, seed);
        expect(plan.sections[0].id).toBe('introduction');
        expect(plan.sections[plan.sections.length - 1].id).toBe('conclusion');
      }
    }
  });

  it('keeps storage and compliance in their fixed places, always', () => {
    for (const t of ALL_TYPES) {
      for (let seed = 0; seed < 100; seed++) {
        const ids = planFor(t, seed).sections.map((s) => s.id);
        expect(ids.indexOf('storage_safety')).toBeLessThan(
          ids.indexOf('compliance_history'),
        );
        expect(ids.indexOf('compliance_history')).toBeLessThan(
          ids.indexOf('conclusion'),
        );
      }
    }
  });

  it('never drops or duplicates a section', () => {
    for (const t of ALL_TYPES) {
      for (let seed = 0; seed < 100; seed++) {
        const ids = planFor(t, seed).sections.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('the_firearm');
        expect(ids).toContain('storage_safety');
      }
    }
  });

  it('explores a real plan space rather than producing two shapes', () => {
    // The actual anti-template property. If this collapses to a handful of
    // combinations, the engine is decorative.
    const seen = new Set<string>();
    const t = MotivationLicenceType.S13_SELF_DEFENCE;
    for (let seed = 0; seed < 1000; seed++) {
      const p = planFor(t, seed);
      seen.add(
        [
          p.sections.map((s) => `${s.id}:${s.heading}`).join('>'),
          p.opening,
          p.closing,
          p.cadence,
        ].join('|'),
      );
    }
    // 3! orders x 4 heading alternates each x 4 openings x 3 closings x 3
    // cadences is a large space; over 1000 seeds we should see hundreds.
    expect(seen.size).toBeGreaterThan(400);
  });

  it('varies the headings, not just the order', () => {
    const t = MotivationLicenceType.S16_DEDICATED_HUNTER;
    const introHeadings = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      introHeadings.add(planFor(t, seed).sections[0].heading);
    }
    expect(introHeadings.size).toBeGreaterThan(1);
  });

  it('keeps the introduction and conclusion to one paragraph', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = planFor(MotivationLicenceType.S24_RENEWAL, seed);
      expect(p.sections[0].paragraphs).toBe(1);
      expect(p.sections[p.sections.length - 1].paragraphs).toBe(1);
    }
  });

  it('survives extreme seeds', () => {
    for (const seed of [0, 1, 2 ** 31 - 1, 2 ** 32 - 1]) {
      const p = planFor(MotivationLicenceType.S15_OCCASIONAL_HUNTER, seed);
      expect(p.sections.length).toBeGreaterThan(4);
      expect(p.sections.every((s) => !!s.heading)).toBe(true);
    }
  });
});

describe('plan verification', () => {
  const plan = planFor(MotivationLicenceType.S16_DEDICATED_HUNTER, 42);

  function docFromPlan(headings: string[]): string {
    return headings
      .map((h) => `${h}\n\nSome body text for this section goes here.`)
      .join('\n\n');
  }

  it('accepts a document that follows the plan', () => {
    const res = followsPlan(docFromPlan(expectedHeadings(plan)), plan);
    expect(res).toEqual({ ok: true, missing: [], outOfOrder: false });
  });

  it('catches a missing section', () => {
    const headings = expectedHeadings(plan).slice(1);
    const res = followsPlan(docFromPlan(headings), plan);
    expect(res.ok).toBe(false);
    expect(res.missing).toHaveLength(1);
  });

  it('catches sections in the wrong order', () => {
    // We ask for a structure and then VERIFY it. A document that ignored the
    // plan means the variation engine did nothing — the failure we cannot
    // afford to miss.
    const headings = [...expectedHeadings(plan)];
    [headings[1], headings[3]] = [headings[3], headings[1]];
    const res = followsPlan(docFromPlan(headings), plan);
    expect(res.ok).toBe(false);
    expect(res.outOfOrder).toBe(true);
  });

  it('is case-insensitive about headings but not about their presence', () => {
    const shouted = expectedHeadings(plan).map((h) => h.toUpperCase());
    expect(followsPlan(docFromPlan(shouted), plan).ok).toBe(true);
  });
});

describe('the sameness detector', () => {
  const DOC_A = [
    'Introduction:',
    'I am applying for a licence in terms of section 16 of the Act. I have hunted for eleven years.',
    'Experience and training:',
    'I completed my competency in 2018. I hunt plains game in the Free State each winter.',
    'Safe storage:',
    'The firearm will be kept in a safe bolted to a brick wall. Nobody else has the code.',
  ].join('\n\n');

  // Same SHAPE, completely different person, different facts and names.
  const DOC_B_SAME_SHAPE = [
    'Introduction:',
    'I am applying for a licence in terms of section 16 of the Act. I have hunted for four years.',
    'Experience and training:',
    'I completed my competency in 2022. I hunt plains game in Limpopo each autumn.',
    'Safe storage:',
    'The firearm will be kept in a safe bolted to a concrete wall. Nobody else has the code.',
  ].join('\n\n');

  // Genuinely different document: different headings, different rhythm.
  const DOC_C_DIFFERENT = [
    'Why I am applying:',
    'My work takes me onto isolated farms after dark, often carrying cash.',
    'Circumstances relevant to this application:',
    'Two armed robberies happened on my route during the past year.',
    'Storage and safekeeping:',
    'A wall-mounted safe in the main bedroom will hold it when it is not carried.',
  ].join('\n\n');

  it('scores two same-shaped documents high even with different content', () => {
    // The whole point: names, dates, places and calibres are stripped, so what
    // is left is how the document was BUILT.
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

  it('the threshold is loose enough not to spin on legitimate overlap', () => {
    // Motivations for the same section share vocabulary by necessity — there
    // are only so many ways to describe a safe bolted to a wall. A threshold
    // that is too tight would regenerate on every document and burn the beta
    // budget on retries.
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
    // The engine exists so the CFR never sees a flood of near-identical
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
    // So if their own earlier document were left in the corpus, a returning
    // applicant would be regenerated away from their own account of their life.
  });
});
