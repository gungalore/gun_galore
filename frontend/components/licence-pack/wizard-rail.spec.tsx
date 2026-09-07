import { describe, expect, it } from 'vitest';
import SECTIONS from '@/lib/__fixtures__/registry-sections.json';
import REQUIREMENTS from '@/lib/__fixtures__/document-requirements.json';
import {
  DISPLAY_OFFSET,
  NOTHING_KNOWN,
  stepAsks,
  stepDone,
  stepsFor,
  toDisplayIndex,
  toWalkedIndex,
  WIZARD_STEPS,
  type StepProgress,
  type WizardStep,
} from './wizard-rail';

// ────────────────────────────────────────────────────────────────────
// A TICK MEANS FINISHED, NOT VISITED — AND NOT "WE HAVE NOT LOOKED YET".
//
// ⚠️ THE RAIL USED TO READ `done = i < current`. A member who clicked ahead to
// type one number they remembered came back to four green ticks over four
// empty steps, and the step they were actually working on could never go green
// however much they put into it.
//
// ⚠️ THEN IT READ `sections.every(s => !outstanding.has(s))`, WHICH TICKED
// EVERYTHING IT WAS TOLD NOTHING ABOUT. An empty outstanding set is what "the
// application has not loaded" and "this member has answered nothing" both look
// like, so eight of eleven steps were green on /licence-services/new before a
// section had even been chosen, and "Dedicated status" and "Declarations" were
// green on the operator's live section 13 before a question was answered.
//
// Operator, 2026-09-07: "check the green tick marks should only be green when
// the section is filled in enough to complete a full motivation."
//
// So the tick is derived from BOTH halves: what this licence type asks, and
// what of it is outstanding.
// ────────────────────────────────────────────────────────────────────

const step = (over: Partial<WizardStep>): WizardStep => ({
  key: 'x',
  name: 'X',
  fills: '',
  title: '',
  blurb: '',
  ...over,
});

/** A licence type that asks everything, with nothing outstanding. */
const asking = (
  sections: string[],
  kinds: string[] = [],
  outstanding: { sections?: string[]; kinds?: string[] } = {},
): StepProgress => ({
  askedSections: new Set(sections),
  askedKinds: new Set(kinds),
  outstandingSections: new Set(outstanding.sections ?? []),
  outstandingKinds: new Set(outstanding.kinds ?? []),
});

// ────────────────────────────────────────────────────────────────────
// THE OPERATOR'S RULE FOR A TICK, WRITTEN AS TESTS.
//
// Operator, 2026-09-07: "the green tick marks should only be green when the
// section is filled in enough to complete a full motivation." On their live
// section 16 the rail carried a tick over Declarations before a single history
// question had been answered, and over the dedicated-status step while the
// association's endorsement was missing.
//
// Two halves, and the second is the one that was wrong: a step is finished when
// every section it covers holds its required answers AND every document it asks
// for is usably attached — where "asks for" now means required OR expected, not
// required alone. The expected tier exists precisely because "optional, but it
// helps" was the wrong thing to say about a paper a DFO will not proceed
// without; a tick over a missing one says the same wrong thing louder.
// ────────────────────────────────────────────────────────────────────
describe("⚠️ the operator's green ticks", () => {
  const declarations = step({ sections: ['History'] });
  const dedicated = step({
    sections: ['Dedicated status'],
    documents: [
      { kind: 'ASSOCIATION_CARD', title: 'a' },
      { kind: 'GOOD_STANDING_LETTER', title: 'b' },
      { kind: 'ASSOCIATION_ENDORSEMENT', title: 'c' },
    ],
  });

  it('does not tick Declarations while a history answer is outstanding', () => {
    expect(
      stepDone(declarations, asking(['History'], [], { sections: ['History'] })),
    ).toBe(false);
  });

  it('ticks Declarations once nothing in it is outstanding', () => {
    expect(stepDone(declarations, asking(['History']))).toBe(true);
  });

  it('⚠️ does not tick the dedicated step while a document it asks for is missing', () => {
    const asked = ['ASSOCIATION_CARD', 'GOOD_STANDING_LETTER', 'ASSOCIATION_ENDORSEMENT'];
    expect(
      stepDone(
        dedicated,
        asking(['Dedicated status'], asked, {
          kinds: ['ASSOCIATION_ENDORSEMENT'],
        }),
      ),
    ).toBe(false);
  });

  it('ticks it once every document it asks for is in', () => {
    const asked = ['ASSOCIATION_CARD', 'GOOD_STANDING_LETTER', 'ASSOCIATION_ENDORSEMENT'];
    expect(stepDone(dedicated, asking(['Dedicated status'], asked))).toBe(true);
  });
});

describe('a step that asks questions', () => {
  const firearm = step({ sections: ['The firearm'] });

  it('is done when nothing it asks is outstanding', () => {
    expect(stepDone(firearm, asking(['The firearm']))).toBe(true);
  });

  it('is not done while one of its sections still holds an answer', () => {
    expect(
      stepDone(
        firearm,
        asking(['The firearm'], [], { sections: ['The firearm'] }),
      ),
    ).toBe(false);
  });

  it("ignores another step's outstanding section", () => {
    expect(
      stepDone(
        firearm,
        asking(['The firearm', 'Storage and safety'], [], {
          sections: ['Storage and safety'],
        }),
      ),
    ).toBe(true);
  });

  it('⚠️ NEEDS EVERY SECTION IT CLAIMS THAT THIS TYPE ASKS, not just one', () => {
    // "Your case" carries three sections and only one of them renders per
    // licence type — but the member on that type must finish theirs.
    const theCase = step({
      sections: ['Your circumstances', 'Experience', 'The existing licence'],
    });
    expect(
      stepDone(theCase, asking(['Experience'], [], { sections: ['Experience'] })),
    ).toBe(false);
  });

  it('⚠️ IGNORES A SECTION THIS LICENCE TYPE DOES NOT ASK', () => {
    // The same "Your case" step on a section 13: only "Your circumstances" is
    // served, so the two hunting sections must not hold the tick hostage.
    const theCase = step({
      sections: ['Your circumstances', 'Experience', 'The existing licence'],
    });
    expect(stepDone(theCase, asking(['Your circumstances']))).toBe(true);
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
  const asked = ['IDENTITY_DOCUMENT', 'ADDRESS_CONFIRMATION'];

  it('⚠️ IS NOT DONE ON ANSWERS ALONE', () => {
    // A document blocks the pack exactly as an answer does, and it is the half
    // the Generate gate was blind to.
    expect(
      stepDone(
        about,
        asking(['About you'], asked, { kinds: ['ADDRESS_CONFIRMATION'] }),
      ),
    ).toBe(false);
  });

  it('is done once both halves are in', () => {
    expect(stepDone(about, asking(['About you'], asked))).toBe(true);
  });
});

describe('⚠️ nothing known ticks nothing', () => {
  it('says nothing about a step before the application has loaded', () => {
    // The state on /licence-services/new, and the first moment of every
    // application. It is also exactly what "this member has answered
    // everything" used to look like, which is why eight steps were green over
    // a section nobody had chosen.
    const firearm = step({ sections: ['The firearm'] });
    expect(stepDone(firearm, NOTHING_KNOWN)).toBe(false);
  });

  it('ticks no step of the real table', () => {
    expect(WIZARD_STEPS.filter((s) => stepDone(s, NOTHING_KNOWN))).toEqual([]);
  });

  it('⚠️ AND HIDES NOTHING EITHER', () => {
    // Silence about progress is honest; hiding half the journey while the
    // fetch is in flight would flicker steps in under the member.
    expect(stepsFor(WIZARD_STEPS, NOTHING_KNOWN)).toEqual(WIZARD_STEPS);
  });
});

describe('⚠️ a step that claims nothing is never ticked from here', () => {
  const everything = asking(
    WIZARD_STEPS.flatMap((s) => s.sections ?? []),
    WIZARD_STEPS.flatMap((s) => (s.documents ?? []).map((d) => d.kind)),
  );

  it('says nothing about the pack step', () => {
    // The last step is the destination, not a task. Nothing on the rail knows
    // whether it is "finished", and a green tick would be an invention.
    const pack = WIZARD_STEPS.find((s) => s.key === 'pack')!;
    expect(stepDone(pack, everything)).toBe(false);
  });

  it("says nothing about the seller's half", () => {
    // "Where it is from" is somebody else's paperwork — waiting, not done.
    const source = WIZARD_STEPS.find((s) => s.key === 'source')!;
    expect(stepDone(source, everything)).toBe(false);
  });

  it('⚠️ BUT BOTH STAY ON THE RAIL', () => {
    // They are stages, not question sets. Filtering them out would delete the
    // beginning and the end of the journey.
    const keys = stepsFor(WIZARD_STEPS, everything).map((s) => s.key);
    expect(keys).toContain('section');
    expect(keys).toContain('source');
    expect(keys).toContain('pack');
  });
});

// ────────────────────────────────────────────────────────────────────
// A SECTION 16 STEP MUST NOT RENDER INSIDE A SECTION 13.
//
// ⚠️ IT DID, ON A LIVE APPLICATION. Step 7 of the operator's self-defence
// application was "Your association and your status", whose own blurb reads
// "A section 16 application rests on this". The registry serves no Dedicated
// status field for S13 and the checklist asks for none of its three documents,
// so the step drew three capture pairs, asked nothing, and was ticked green.
//
// The fixtures are generated from the server's own fieldsFor() and
// documentStatus(), so this fails in the direction the mistake comes from: a
// step whose sections or documents stop being served for a licence type.
// ────────────────────────────────────────────────────────────────────

type Need = { kind: string; tier: string; label: string };
const TYPES = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];

const planFor = (t: keyof typeof SECTIONS): StepProgress => ({
  askedSections: new Set(SECTIONS[t] as string[]),
  askedKinds: new Set(
    (REQUIREMENTS[t] as unknown as Need[]).map((n) => n.kind),
  ),
  outstandingSections: new Set(),
  outstandingKinds: new Set(),
});

describe('the steps a licence type actually has', () => {
  it('covers all five licence types', () => {
    // If this reads fewer than five, every assertion below passes for the
    // wrong reason.
    expect(TYPES).toHaveLength(5);
  });

  it('⚠️ A SECTION 13 HAS NO DEDICATED-STATUS STEP', () => {
    const keys = stepsFor(WIZARD_STEPS, planFor('S13_SELF_DEFENCE')).map(
      (s) => s.key,
    );
    expect(keys).not.toContain('dedicated');
  });

  it('a section 16 keeps it — it is the whole application', () => {
    for (const t of ['S16_DEDICATED_HUNTER', 'S16_DEDICATED_SPORT'] as const) {
      const keys = stepsFor(WIZARD_STEPS, planFor(t)).map((s) => s.key);
      expect({ type: t, has: keys.includes('dedicated') }).toEqual({
        type: t,
        has: true,
      });
    }
  });

  it.each(TYPES)('%s — every step shown asks something', (type) => {
    const plan = planFor(type);
    const idle = stepsFor(WIZARD_STEPS, plan)
      .filter((s) => (s.sections ?? []).length + (s.documents ?? []).length > 0)
      .filter((s) => !stepAsks(s, plan))
      .map((s) => s.key);
    expect({ type, idle }).toEqual({ type, idle: [] });
  });

  it.each(TYPES)('%s — no step this type asks for is dropped', (type) => {
    // The other direction: a step whose sections ARE served must survive the
    // filter, or the member loses questions the pack still counts against them.
    const plan = planFor(type);
    const shown = new Set(stepsFor(WIZARD_STEPS, plan).map((s) => s.key));
    const dropped = WIZARD_STEPS.filter(
      (s) =>
        !shown.has(s.key) &&
        ((s.sections ?? []).some((sec) => plan.askedSections.has(sec)) ||
          (s.documents ?? []).some((d) => plan.askedKinds.has(d.kind))),
    ).map((s) => s.key);
    expect({ type, dropped }).toEqual({ type, dropped: [] });
  });

  it.each(TYPES)('%s — keeps the section, source and pack stages', (type) => {
    const keys = stepsFor(WIZARD_STEPS, planFor(type)).map((s) => s.key);
    expect(keys.slice(0, 1)).toEqual(['section']);
    expect(keys).toContain('source');
    expect(keys[keys.length - 1]).toBe('pack');
  });

  it.each(TYPES)(
    '%s — ⚠️ A FRESH APPLICATION TICKS NOTHING BUT THE SECTION',
    (type) => {
      // Every question outstanding, every document missing: the state the
      // operator was looking at when two steps were already green.
      const plan = planFor(type);
      const fresh: StepProgress = {
        ...plan,
        outstandingSections: new Set(plan.askedSections),
        outstandingKinds: new Set(plan.askedKinds),
      };
      const ticked = stepsFor(WIZARD_STEPS, fresh)
        .filter((s) => stepDone(s, fresh))
        .map((s) => s.key);
      // The section step is ticked by the rail's own `lockedBefore`, not by
      // stepDone — it was completed on the screen before this one.
      expect({ type, ticked }).toEqual({ type, ticked: [] });
    },
  );
});

// ────────────────────────────────────────────────────────────────────
// THE TWO INDEXES STILL ROUND-TRIP AGAINST THE LIST A MEMBER ACTUALLY WALKS.
//
// ⚠️ lib/wizard-step-offset.spec.ts PINS `APPLICATION_STEPS`, WHICH NOTHING
// WALKS. That constant is the UNFILTERED table, kept only so DISPLAY_OFFSET and
// the conversions have something fixed to be defined against — its own doc
// comment says it "must not be used to walk a real application". The invariant
// that now matters is this one: `toDisplayIndex` / `toWalkedIndex` still line
// up against `stepsFor(...)`, for every licence type, BECAUSE a claimless step
// can never be filtered out and the section step is claimless. If someone ever
// gives the section step a section or a document, this fails — and the symptom
// in production would be the right heading over somebody else's questions.
// ────────────────────────────────────────────────────────────────────

describe('⚠️ the walk and the rail stay one apart, per licence type', () => {
  it.each(TYPES)('%s', (type) => {
    const rail = stepsFor(WIZARD_STEPS, planFor(type));
    const walked = rail.slice(DISPLAY_OFFSET);

    // The offset is exactly the claimless section step, which survives every
    // filter — so the walk is the rail minus its first entry, always.
    expect(rail[0].key).toBe('section');
    expect(rail).toHaveLength(walked.length + DISPLAY_OFFSET);

    walked.forEach((step, i) => {
      expect(rail[toDisplayIndex(i)].key).toBe(step.key);
      expect(toWalkedIndex(toDisplayIndex(i))).toBe(i);
    });

    // And a click on the section step is not silently re-read as the first
    // walked one — the control that appears to do nothing.
    expect(toWalkedIndex(0)).toBeNull();
  });
});


// ────────────────────────────────────────────────────────────────────
// A STAGE THAT NAMES ITS OWN QUESTION LEAVES WITH IT.
//
// ⚠️ "WHERE IT IS FROM" WAS ON EVERY RENEWAL. The step claims no section and
// no document — it is the seller's half of the paperwork — and stepAsks keeps
// claimless steps on purpose: "a stage, not a question set". A section 24
// applicant already owns the firearm, and the stage told them "a dealer sale
// and a private transfer need different paperwork at the counter" about a
// transfer that is not happening. The backend had known all along; the
// checklist says in capitals that a renewal has no source document.
// ────────────────────────────────────────────────────────────────────
describe("⚠️ the stage a renewal should never see", () => {
  const source = WIZARD_STEPS.find((x) => x.key === 'source')!;
  const base = {
    askedSections: new Set(['The firearm']),
    askedKinds: new Set(['IDENTITY_DOCUMENT']),
    outstandingSections: new Set<string>(),
    outstandingKinds: new Set<string>(),
  };

  it('claims the one question it exists for', () => {
    expect(source.keys).toEqual(['firearm_source']);
  });

  it('stays where the application is served that question', () => {
    expect(
      stepAsks(source, { ...base, askedKeys: new Set(['firearm_source']) }),
    ).toBe(true);
  });

  it('goes where it is not', () => {
    expect(
      stepAsks(source, { ...base, askedKeys: new Set(['firearm_make']) }),
    ).toBe(false);
  });

  it('⚠️ stays when nobody has said, because unknown must not delete a step', () => {
    expect(stepAsks(source, base)).toBe(true);
  });

  it('leaves every other step alone', () => {
    const withKeys = { ...base, askedKeys: new Set<string>() };
    for (const st of WIZARD_STEPS) {
      if (st.keys?.length) continue;
      expect(stepAsks(st, withKeys)).toBe(stepAsks(st, base));
    }
  });
});
