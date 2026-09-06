import { describe, expect, it } from 'vitest';
import SECTIONS from './__fixtures__/registry-sections.json';
import { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';
import { STEP_PLAN } from '@/lib/motivation-step-plan';
import {
  duplicateClaims,
  emptyClaims,
  homelessSections,
  type StepLike,
} from './wizard-coverage';

// ────────────────────────────────────────────────────────────────────
// EVERY QUESTION HAS A HOME.
//
// ⚠️ THIS SUITE EXISTS BECAUSE FOUR SECTIONS HAD NONE, AND NOTHING SAID SO.
// The wizard was built from an artboard drawn for a section 16 dedicated sport
// shooter, so it had a step for each section that applicant sees and no step
// at all for:
//
//   Experience             12 fields   what you hunt or compete in  (S15, S16)
//   Your circumstances      3 fields   the threat case              (S13)
//   The existing licence    3 fields   what is being renewed        (S24)
//   The SAPS 271 form       1 field    the fill-it-in opt-in
//
// Nineteen questions the classic wizard asks and the new one did not. A member
// would have walked every step, been told nothing was outstanding, and been
// unable to generate a pack — with nothing on screen naming the reason,
// because a section with no step simply never renders while missingRequired
// still counts it against them.
//
// Three of those four are the S13, S15 and S24 paths, which the artboard never
// draws. Building to a picture of one licence type would have shipped a wizard
// that cannot do three of the five.
//
// The fixture is generated from the server's own fieldsFor(), so this fails
// when a section is added to the registry and not given a step — which is the
// direction the mistake actually comes from.
// ────────────────────────────────────────────────────────────────────

const TYPES = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];

// ────────────────────────────────────────────────────────────────────
// ⚠️ BOTH STEP TABLES, BECAUSE THERE ARE TWO WIZARDS AND ONLY ONE WAS COVERED.
//
// This suite imported the PACK screen's WIZARD_STEPS and nothing else — and
// that screen is behind a flag that is OFF. The wizard members actually walk
// today, /motivations/[id], has its own table and was guarded by nothing: a
// registry section added tomorrow could be homeless there and every assertion
// below would still pass. Its constant moved to lib/motivation-step-plan.ts so
// it could be imported here; that is the only reason it moved.
// ────────────────────────────────────────────────────────────────────
const TABLES: { name: string; steps: StepLike[] }[] = [
  { name: 'the pack wizard (/licence-services/[id])', steps: WIZARD_STEPS },
  { name: 'the live wizard (/motivations/[id])', steps: STEP_PLAN },
];

/** The registry serves fields; the guard only needs their section names. */
const fieldsOf = (t: keyof typeof SECTIONS) =>
  SECTIONS[t].map((section, i) => ({
    key: `f${i}`,
    label: section,
    kind: 'short' as const,
    section,
  }));

describe('every registry section has a wizard step', () => {
  it('covers all five licence types', () => {
    // If this reads fewer than five, the fixture is stale and every test
    // below passes for the wrong reason.
    expect(TYPES).toHaveLength(5);
  });

  for (const table of TABLES) {
    it.each(TYPES)(`${table.name} · %s — no section is homeless`, (type) => {
      const homeless = homelessSections(fieldsOf(type), table.steps);
      // Named, not counted: the failure message has to say WHICH question
      // nobody can answer.
      expect({ type, homeless }).toEqual({ type, homeless: [] });
    });

    it(`${table.name} — claims no section the registry never serves`, () => {
      // The gentler failure — a heading with nothing under it — but usually a
      // typo in a section name, which the other direction cannot catch.
      const everySection = TYPES.flatMap((t) => fieldsOf(t));
      expect(emptyClaims(everySection, table.steps)).toEqual([]);
    });

    it(`${table.name} — gives no section two homes`, () => {
      // Two steps asking the same questions is the same answer typed twice and
      // a member wondering which one counts.
      expect(duplicateClaims(table.steps)).toEqual([]);
    });
  }

  it.each(TABLES.map((t) => t.name))(
    '%s — ⚠️ keeps a home for the three paths the artboard never draws',
    (name) => {
    // The artboard is one section 16 sport shooter. These three are the whole
    // of the S13, S15/S16 and S24 arguments, and each was homeless.
    const table = TABLES.find((t) => t.name === name)!;
    const claimed = new Set(table.steps.flatMap((s) => s.sections ?? []));
    for (const section of [
      'Your circumstances',
      'Experience',
      'The existing licence',
      'The SAPS 271 form',
    ]) {
      expect({ section, claimed: claimed.has(section) }).toEqual({
        section,
        claimed: true,
      });
    }
  },
  );
});

describe('the guard itself', () => {
  const steps = [{ key: 'a', sections: ['One'] }];

  it('reports a section with no step', () => {
    const fields = [
      { key: 'x', label: 'x', kind: 'short' as const, section: 'One' },
      { key: 'y', label: 'y', kind: 'short' as const, section: 'Two' },
    ];
    expect(homelessSections(fields, steps)).toEqual(['Two']);
  });

  it('reports each homeless section once, however many fields it has', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({
      key: `k${i}`,
      label: 'x',
      kind: 'short' as const,
      section: 'Experience',
    }));
    expect(homelessSections(fields, steps)).toEqual(['Experience']);
  });

  it('ignores steps that ask nothing — the pack step has no section', () => {
    expect(homelessSections([], [{ key: 'pack' }])).toEqual([]);
  });
});
