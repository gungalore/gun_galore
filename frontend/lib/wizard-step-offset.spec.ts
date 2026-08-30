import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STEPS,
  DISPLAY_OFFSET,
  toDisplayIndex,
  toWalkedIndex,
  WIZARD_STEPS,
} from '@/components/licence-pack/wizard-rail';

// ────────────────────────────────────────────────────────────────────
// ELEVEN ON THE RAIL, TEN IN THE WALK.
//
// Operator, 2026-08-30: "make it a 10 step process, remove step1 out of the
// process and make it the form selection as it was but still keep the visuals
// a 11 step process… essentially Step2 on the frontend is step 1 in the
// backend."
//
// ⚠️ THIS SUITE EXISTS BECAUSE THE TWO INDEXES ARE BOTH `number` AND tsc
// CANNOT TELL THEM APART. An off-by-one does not throw. It renders the wrong
// step's questions under the right step's heading — a member answering the
// firearm's serial numbers into the storage section, with every screen looking
// entirely normal.
//
// The far worse failure is silent too: APPLICATION_STEPS is WIZARD_STEPS.slice(1),
// so anybody who reorders the rail and does not put the section first drops a
// REAL step out of the application. Its questions would simply never be asked,
// missingRequired would still count them, and the pack would refuse to finish
// with nothing on screen naming the reason. That is the last test here and it
// is the one that matters.
// ────────────────────────────────────────────────────────────────────

describe('the split', () => {
  it('walks one fewer step than it draws', () => {
    expect(APPLICATION_STEPS).toHaveLength(WIZARD_STEPS.length - 1);
    expect(DISPLAY_OFFSET).toBe(1);
  });

  it('drops the section step and nothing else', () => {
    expect(APPLICATION_STEPS.map((s) => s.key)).not.toContain('section');
    expect(APPLICATION_STEPS.map((s) => s.key)).toEqual(
      WIZARD_STEPS.filter((s) => s.key !== 'section').map((s) => s.key),
    );
  });

  it('keeps the rail whole — the section is still drawn', () => {
    // The member chose it. Hiding it would make the journey look shorter than
    // the one they are actually on, and the tick is the point.
    expect(WIZARD_STEPS.map((s) => s.key)).toContain('section');
  });
});

describe('converting between them', () => {
  it('round-trips every walked step', () => {
    for (let i = 0; i < APPLICATION_STEPS.length; i++) {
      expect(toWalkedIndex(toDisplayIndex(i))).toBe(i);
    }
  });

  it('points each walked step at its own entry on the rail', () => {
    // The real assertion: the step the body renders and the step the rail
    // highlights must be the same object, not merely the same number.
    for (let i = 0; i < APPLICATION_STEPS.length; i++) {
      expect(WIZARD_STEPS[toDisplayIndex(i)].key).toBe(APPLICATION_STEPS[i].key);
    }
  });

  it('⚠️ REFUSES THE SECTION STEP RATHER THAN CLAMPING TO ZERO', () => {
    // A clamp would make a click on the section step quietly select the
    // firearm step — a control that appears to do nothing, which is the
    // failure this whole change exists to remove.
    expect(toWalkedIndex(0)).toBeNull();
  });

  it('puts the first walked step second on the rail, and the last one last', () => {
    expect(toDisplayIndex(0)).toBe(1);
    expect(toDisplayIndex(APPLICATION_STEPS.length - 1)).toBe(
      WIZARD_STEPS.length - 1,
    );
  });
});

describe('⚠️ what the slice is allowed to drop', () => {
  it('never drops a step that asks a question or takes a document', () => {
    // APPLICATION_STEPS is a slice, so reordering the rail silently changes
    // WHICH step leaves the application. A step carrying registry sections or
    // capture cards must never be the one that goes: its questions would never
    // be asked while missingRequired still counted them, and the pack would
    // refuse to finish with no reason on screen.
    const dropped = WIZARD_STEPS.filter(
      (s) => !APPLICATION_STEPS.some((a) => a.key === s.key),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0].sections ?? []).toEqual([]);
    expect(dropped[0].documents ?? []).toEqual([]);
  });

  it('leaves every question-asking step in the walk', () => {
    const asking = WIZARD_STEPS.filter(
      (s) => (s.sections?.length ?? 0) > 0 || (s.documents?.length ?? 0) > 0,
    );
    for (const s of asking) {
      expect(
        APPLICATION_STEPS.map((a) => a.key),
        `${s.key} must still be walked`,
      ).toContain(s.key);
    }
  });
});
