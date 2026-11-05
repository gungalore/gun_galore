import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from './motivation-sheet.service';
import {
  planFor,
  type PlanOptions,
  type SectionId,
  type StructurePlan,
} from './motivation-structure';
import {
  generationSystemPrompt,
  generationUserPrompt,
  type FactPack,
} from './motivation-prompts';
import { fieldByKey, isVisible, requiredKeys } from './motivation-fields';
import { strategyFor } from './intake/intake-strategies';
import { GROUP_CAP, planGroup } from './intake/intake-planner';
import { topicForField } from './intake/intake-topics';

// ────────────────────────────────────────────────────────────────────
// EVERY LICENCE TYPE GETS THE SAME QUALITY OF TREATMENT.
//
// ⚠️ THIS IS A TEST RATHER THAN A REVIEW BECAUSE THE FAILURES ARE SILENT.
// The type-specific machinery is four maps keyed by licence type (the section
// skeletons, the briefs, the strategy field lists, the paragraph budgets) plus
// two overrides tables. Add a section to one skeleton and forget its brief and
// nothing crashes: the writer is handed the literal string "undefined" as its
// instruction and produces a thin section. Add a required field that no
// strategy lists and the interview never asks it, the pack is refused for an
// answer the screen cannot collect, and the member is stuck with no question
// left to answer.
//
// Both have happened. The 271 removal and the motivation-only/print-ready
// split rewrote the section layer under every type at once, which is exactly
// when one type quietly loses a section, a brief or a guard. So the matrix
// walks every type, seeds and option combination and asserts the same six
// things for each: a real brief, a paragraph budget, one purpose section, the
// three policy guards, no unaskable required field, and a group whose
// questions all belong to it.
// ────────────────────────────────────────────────────────────────────

const TYPES: MotivationLicenceType[] = Object.values(MotivationLicenceType);

/** Two seeds: the plan should not depend on one. */
const SEEDS = [0, 7] as const;

/**
 * Every branch the skeleton can take: holding a firearm, a declaration, an
 * association, and which purpose heading leads. The union of these is the
 * section vocabulary any type can produce.
 */
const OPTION_SETS: PlanOptions[] = [];
for (const holdsFirearms of [false, true]) {
  for (const hasRecord of [false, true]) {
    for (const isAssociationMember of [false, true]) {
      for (const purpose of ['hunting', 'sport'] as const) {
        OPTION_SETS.push({ holdsFirearms, hasRecord, isAssociationMember, purpose });
      }
    }
  }
}

const EMPTY_SHEET = {
  application: {},
  sections: [],
  items: [],
  documents: [],
  needs: { needs: [], missingRequired: [] },
  credentials: {},
  overlap: { verdict: { kind: 'none' }, prompt: null, suggestedAngle: null },
  preview: [],
  missing: [],
  ownedRows: [],
} as unknown as SheetResponse;

function packFor(licenceType: MotivationLicenceType): FactPack {
  return { licenceType, answers: {}, derived: {} };
}

/**
 * The brief a section actually got, read back out of the prompt.
 *
 * ⚠️ THE BRIEFS ARE NOT EXPORTED, DELIBERATELY — a brief is only real if it
 * reaches the writer, so the assertion goes through the prompt the writer is
 * given rather than through the table. A missing entry arrives as the literal
 * "undefined", which is what makes this catch an orphan id.
 */
function briefOf(prompt: string, plan: StructurePlan, index: number): string {
  const section = plan.sections[index];
  const at = prompt.indexOf(section.heading);
  if (at < 0) return '';
  const next = plan.sections[index + 1]?.heading;
  const nextAt = next ? prompt.indexOf(next, at + section.heading.length) : -1;
  const block = nextAt < 0 ? prompt.slice(at) : prompt.slice(at, nextAt);
  const arrow = block.indexOf('\u2192');
  if (arrow < 0) return '';
  return block.slice(arrow + 1).trim();
}

const PURPOSE_IDS: ReadonlySet<SectionId> = new Set([
  'the_threat',
  'the_quarry',
  'the_discipline',
  'use_since_licensing',
]);

/** Which purpose section an application of this type leads with. */
function expectedPurpose(type: MotivationLicenceType, opts: PlanOptions): SectionId {
  if (type === MotivationLicenceType.S24_RENEWAL) return 'use_since_licensing';
  if (
    type === MotivationLicenceType.S13_SELF_DEFENCE ||
    type === MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE
  ) {
    return 'the_threat';
  }
  return opts.purpose === 'sport' ? 'the_discipline' : 'the_quarry';
}

describe('section parity across licence types', () => {
  it.each(TYPES)('%s: every planned section carries a real brief', (type) => {
    for (const opts of OPTION_SETS) {
      for (const seed of SEEDS) {
        const plan = planFor(type, seed, opts);
        expect(plan.sections.length).toBeGreaterThan(0);
        const prompt = generationUserPrompt(packFor(type), plan);
        for (const [index, section] of plan.sections.entries()) {
          const brief = briefOf(prompt, plan, index);
          expect(brief.startsWith('undefined')).toBe(false);
          expect(brief.length).toBeGreaterThanOrEqual(80);
          expect(section.paragraphs).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  // The section vocabulary any type can produce: every id the matrix reaches
  // must carry a brief, which is what catches a section added to one skeleton
  // without one.
  it('has a brief for every section id any licence type can produce', () => {
    const observed = new Map<SectionId, string>();
    for (const type of TYPES) {
      for (const opts of OPTION_SETS) {
        const plan = planFor(type, 0, opts);
        const prompt = generationUserPrompt(packFor(type), plan);
        for (const [index, section] of plan.sections.entries()) {
          const brief = briefOf(prompt, plan, index);
          if (!observed.has(section.id)) observed.set(section.id, brief);
        }
      }
    }
    expect(observed.size).toBeGreaterThan(5);
    for (const [id, brief] of observed) {
      expect(`${id}: ${brief.startsWith('undefined')}`).toBe(`${id}: false`);
      expect(`${id}: ${brief.length >= 80}`).toBe(`${id}: true`);
    }
  });

  it.each(TYPES)('%s: leads with exactly one purpose section, and the right one', (type) => {
    for (const opts of OPTION_SETS) {
      const plan = planFor(type, 0, opts);
      const purposes = plan.sections.filter((s) => PURPOSE_IDS.has(s.id));
      expect(purposes).toHaveLength(1);
      expect(purposes[0].id).toBe(expectedPurpose(type, opts));
    }
  });

  it.each(TYPES)('%s: carries the grounding, places and exact-name guards', (type) => {
    const system = generationSystemPrompt(type);
    // The system prompt carries the grounding rule and the no-invention ban,
    // which names a place explicitly.
    expect(system).toContain("THE APPLICANT'S FACTS COME FIRST");
    expect(system).toContain('Never fabricate a circumstance, date, place');
    expect(system.toLowerCase()).toContain('never invent');

    // The per-applicant final instruction carries all three, restated last.
    const prompt = generationUserPrompt(packFor(type), planFor(type, 0, {}));
    expect(prompt).toContain('1. GROUNDING');
    expect(prompt).toContain('3. PLACES.');
    expect(prompt).toContain(
      'Never name a province, region, town, farm, ranch, reserve or hunting',
    );
    expect(prompt).toContain('4. NAMES ARE COPIED');
    expect(prompt).toContain('written exactly as the facts give them');
  });

  it.each(TYPES)('%s: has no required field the interview cannot ask', (type) => {
    const askable = new Set(strategyFor(type).fields);
    const unaskable = requiredKeys(type, {}).filter((key) => {
      const field = fieldByKey(type, key);
      if (!field) return true;
      // A document-sourced answer arrives from the paperwork, not the screen.
      if (field.docSourced) return false;
      return !askable.has(key);
    });
    expect(unaskable).toEqual([]);
  });

  it.each(TYPES)('%s: asks its first questions in one topic', (type) => {
    const group = planGroup({ type, answers: {}, sheet: EMPTY_SHEET });
    expect(group).not.toBeNull();
    expect(group?.questions.length).toBeGreaterThan(0);
    expect(group?.questions.length).toBeLessThanOrEqual(GROUP_CAP);
    for (const question of group?.questions ?? []) {
      expect(topicForField(question.key)).toBe(group?.id);
      // And the field really is askable on this type.
      const field = fieldByKey(type, question.key);
      expect(field).toBeDefined();
      expect(isVisible(field!, {})).toBe(true);
    }
  });
});
