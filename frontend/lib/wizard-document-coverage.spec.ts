import { describe, expect, it } from 'vitest';
import REQUIREMENTS from './__fixtures__/document-requirements.json';
import { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';
import { STEP_PLAN } from '@/lib/motivation-step-plan';

// ────────────────────────────────────────────────────────────────────
// EVERY DOCUMENT HAS A DOOR.
//
// ⚠️ THE QUESTIONS WERE ASSERTED AND THE DOCUMENTS WERE NOT, AND THAT
// ASYMMETRY IS THE WHOLE BUG. wizard-coverage.spec.ts has guarded since
// 2026-08-28 that every registry SECTION has a wizard step — it exists because
// four sections had none and nineteen questions were unanswerable. Nothing
// made the same promise about DOCUMENTS, and four kinds the pack asks for have
// no capture card on any step:
//
//   ASSOCIATION_ENDORSEMENT   expected on both section 16 paths
//   CHARACTER_REFERENCE       strengthens S13, S15 and both S16 paths
//   SHOOTING_ACTIVITY_LOG     strengthens S15, both S16 paths and S24
//   INCIDENT_REPORT           strengthens S13
//
// The failure is quiet in the worst way. The checklist on the final step still
// LISTS them, so the member is told the pack wants an association endorsement
// and is never given anywhere to attach one — the same shape as the nineteen
// orphaned questions, moved from the answers side to the documents side.
//
// ⚠️ A BULK "UPLOAD EVERYTHING" DOOR DOES NOT SATISFY THIS. Letting a member
// drop any file in is not the same as ASKING for a document at the step where
// they are thinking about it, which is the entire premise of the rebuilt
// wizard. A kind that only arrives by accident is a kind we did not ask for.
//
// The fixture is generated from the server's own documentStatus(), so this
// fails when a document is added to a licence type and not given a door —
// which is the direction the mistake actually comes from.
// ────────────────────────────────────────────────────────────────────

type Need = { kind: string; tier: string; label: string };
const TYPES = Object.keys(REQUIREMENTS) as (keyof typeof REQUIREMENTS)[];

/** Every document kind the pack wizard offers a capture card for. */
const offered = new Set(
  WIZARD_STEPS.flatMap((s) => (s.documents ?? []).map((d) => d.kind)),
);

// ────────────────────────────────────────────────────────────────────
// ⚠️ THE TWO WIZARDS ASK FOR DOCUMENTS IN TWO DIFFERENT SHAPES, AND ONLY ONE
// OF THEM CAN BE ASSERTED THIS WAY.
//
// The pack wizard binds a capture card to a kind ON THE STEP that asks it, so
// a kind with no card is a document nobody can attach — the whole reason this
// file exists. The live wizard at /motivations/[id] instead renders the SERVED
// checklist on one step: every kind the server asks for gets a row, so it can
// never orphan a kind, and the thing that CAN go wrong there is the step
// disappearing or being renamed out from under the "take me to the documents"
// jump the Generate gate uses. That is what is asserted for it below.
// ────────────────────────────────────────────────────────────────────
const LIVE_DOCUMENTS_STEP = 'documents';

/** What the pack asks for on this licence type, by tier. */
const needs = (t: keyof typeof REQUIREMENTS): Need[] =>
  REQUIREMENTS[t] as unknown as Need[];

describe('every document the pack asks for has a capture card', () => {
  it('covers all five licence types', () => {
    // If this reads fewer than five, every assertion below passes for the
    // wrong reason.
    expect(TYPES).toHaveLength(5);
  });

  it.each(TYPES)('%s — nothing REQUIRED is homeless', (type) => {
    const homeless = needs(type)
      .filter((n) => n.tier === 'required')
      .filter((n) => !offered.has(n.kind))
      .map((n) => `${n.kind} (${n.label})`);
    // Named, not counted: the failure has to say WHICH document nobody can
    // attach.
    expect({ type, homeless }).toEqual({ type, homeless: [] });
  });

  it.each(TYPES)('%s — nothing EXPECTED is homeless', (type) => {
    // ⚠️ EXPECTED IS NOT OPTIONAL IN THE WAY THE WORD SUGGESTS. The DFO asks
    // for these; a pack without one is a pack that comes back.
    const homeless = needs(type)
      .filter((n) => n.tier === 'expected')
      .filter((n) => !offered.has(n.kind))
      .map((n) => `${n.kind} (${n.label})`);
    expect({ type, homeless }).toEqual({ type, homeless: [] });
  });

  it.each(TYPES)('%s — nothing that STRENGTHENS is homeless', (type) => {
    // These are the ones a member most needs prompting for: nobody attaches a
    // character reference or a shooting log unless asked, and they are exactly
    // what turns a thin application into a good one.
    const homeless = needs(type)
      .filter((n) => n.tier === 'strengthens')
      .filter((n) => !offered.has(n.kind))
      .map((n) => `${n.kind} (${n.label})`);
    expect({ type, homeless }).toEqual({ type, homeless: [] });
  });

  it('offers no capture card for a document nothing ever asks for', () => {
    // The gentler failure — a card nobody needs — but usually a typo in a
    // kind, which the other direction cannot catch.
    const asked = new Set(TYPES.flatMap((t) => needs(t).map((n) => n.kind)));
    const spurious = [...offered].filter((k) => !asked.has(k));
    expect(spurious).toEqual([]);
  });

  it('⚠️ THE LIVE WIZARD STILL HAS A STEP THAT TAKES DOCUMENTS', () => {
    // Its gate names the missing kinds and sends the member to this step. A
    // rename here without a rename there is a button that jumps to the wrong
    // screen and a member who cannot find what they were just told to attach.
    const step = STEP_PLAN.find((s) => s.key === LIVE_DOCUMENTS_STEP);
    expect(step?.key).toBe(LIVE_DOCUMENTS_STEP);
    // It carries the SAPS 271 opt-in, which is what turns ~48 form-only fields
    // on; the checklist beside it is served, so no kind can be orphaned there.
    expect(step?.sections).toContain('The SAPS 271 form');
  });

  it('⚠️ ASKS FOR NO CHARACTER REFERENCE, ON ANY LICENCE TYPE', () => {
    // Operator, 2026-08-29: "It serves no purpose. Only time someone needs
    // these is for the application for a competency." A reference speaks to
    // whether a person is FIT to hold a firearm — the section 9 enquiry
    // behind SAPS 517 — not to why THIS firearm is needed for THIS purpose.
    // Asking for one sent a member to fetch a document that could not help.
    //
    // The kind survives in the enum so an upload attached before the decision
    // still renders; nothing asks for it and no step offers a door.
    for (const t of TYPES) {
      const asked = needs(t).filter((n) => n.kind === 'CHARACTER_REFERENCE');
      expect({ type: t, asked }).toEqual({ type: t, asked: [] });
    }
    expect(offered.has('CHARACTER_REFERENCE')).toBe(false);
  });
});
