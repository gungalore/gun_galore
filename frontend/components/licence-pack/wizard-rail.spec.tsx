import { describe, expect, it } from 'vitest';
import { stepDone, WIZARD_STEPS, type WizardStep } from './wizard-rail';

// ────────────────────────────────────────────────────────────────────
// A TICK MEANS FINISHED, NOT VISITED.
//
// ⚠️ THE RAIL USED TO READ `done = i < current`. A member who clicked ahead to
// type one number they remembered came back to four green ticks over four
// empty steps, and the step they were actually working on could never go green
// however much they put into it. The one signal on the rail said the opposite
// of the truth, which is worse than no signal — somebody trusting it reaches
// the pack step and is refused with a list of things four "finished" steps
// never asked them.
//
// The tick is derived from what the step CLAIMS: its registry sections and its
// document kinds, against what is still outstanding.
// ────────────────────────────────────────────────────────────────────

const step = (over: Partial<WizardStep>): WizardStep => ({
  key: 'x',
  name: 'X',
  fills: '',
  title: '',
  blurb: '',
  ...over,
});

const none = new Set<string>();

describe('a step that asks questions', () => {
  const firearm = step({ sections: ['The firearm'] });

  it('is done when nothing it asks is outstanding', () => {
    expect(stepDone(firearm, none, none)).toBe(true);
  });

  it('is not done while one of its sections still holds an answer', () => {
    expect(stepDone(firearm, new Set(['The firearm']), none)).toBe(false);
  });

  it("ignores another step's outstanding section", () => {
    expect(stepDone(firearm, new Set(['Storage and safety']), none)).toBe(true);
  });

  it('⚠️ NEEDS EVERY SECTION IT CLAIMS, not just one', () => {
    // "Your case" carries three sections and only one of them renders per
    // licence type — but the member on that type must finish theirs.
    const theCase = step({
      sections: ['Your circumstances', 'Experience', 'The existing licence'],
    });
    expect(stepDone(theCase, new Set(['Experience']), none)).toBe(false);
  });
});

describe('a step that takes documents', () => {
  const about = step({
    sections: ['About you'],
    documents: [
      { kind: 'IDENTITY_DOCUMENT', title: 'Your ID' },
      { kind: 'ADDRESS_CONFIRMATION', title: 'Proof of address' },
    ],
  });

  it('⚠️ IS NOT DONE ON ANSWERS ALONE', () => {
    // A document blocks the pack exactly as an answer does, and it is the half
    // the Generate gate was blind to.
    expect(stepDone(about, none, new Set(['ADDRESS_CONFIRMATION']))).toBe(false);
  });

  it('is done once both halves are in', () => {
    expect(stepDone(about, none, none)).toBe(true);
  });
});

describe('⚠️ a step that claims nothing is never ticked from here', () => {
  it('says nothing about the pack step', () => {
    // The last step is the destination, not a task. Nothing on the rail knows
    // whether it is "finished", and a green tick would be an invention.
    const pack = WIZARD_STEPS.find((s) => s.key === 'pack')!;
    expect(stepDone(pack, none, none)).toBe(false);
  });

  it("says nothing about the seller's half", () => {
    // "Where it is from" is somebody else's paperwork — waiting, not done.
    const source = WIZARD_STEPS.find((s) => s.key === 'source')!;
    expect(stepDone(source, none, none)).toBe(false);
  });
});
