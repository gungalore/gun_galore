import { describe, expect, it } from 'vitest';
import REQUIREMENTS from './__fixtures__/document-requirements.json';
import { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';

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

/** Every document kind the wizard offers a capture card for. */
const offered = new Set(
  WIZARD_STEPS.flatMap((s) => (s.documents ?? []).map((d) => d.kind)),
);

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
