// ────────────────────────────────────────────────────────────────────
// THE LIVE WIZARD'S SIX STEPS, AND WHICH VAULT BUCKET EACH SECTION READS.
//
// ⚠️ LIFTED OUT OF app/motivations/[id]/page.tsx SO THE GUARDS CAN SEE IT.
// Three suites — wizard-coverage, wizard-document-coverage, vault-prefix-
// coverage — assert that every registry section has a step, every document has
// a door and every vault prefix matches a field on its own step. All three
// imported the PACK screen's WIZARD_STEPS and only that, so the table the
// members actually walk today was covered by nothing at all: a registry section
// added tomorrow could be homeless on the live wizard and every one of those
// tests would still pass.
//
// A page module cannot be imported from a spec (it is a route with 'use client'
// and a default export React expects to mount), so the constant moved here and
// the page imports it. One definition, two readers.
//
// ⚠️ A STEP IS A UNION OF WHOLE REGISTRY SECTIONS, NEVER PART OF ONE. Every
// showIf pair in the registry is intra-section, so keeping sections whole keeps
// all of them inside one step no matter how the steps are ordered — a field can
// never be gated by an answer on a screen the applicant has not reached.
//
// ⚠️ THE SAPS-271 OPT-IN SITS IN STEP 1, and that placement is load-bearing.
// It is the one gate that crosses sections: answering "fill it in for me" turns
// on ~48 formOnly fields spread through steps 2, 4 and 5. Asked first, the lean
// dealer path stays the default and the form only grows when somebody asks it
// to. Asked later, those fields would appear behind the applicant.
//
// Sections are matched BY NAME, which is what groupBySection buckets on. A
// section that is not named here still renders — see UNPLANNED_STEP in the page
// — so a new registry section can never silently vanish from the form.
// ────────────────────────────────────────────────────────────────────

import { OWNED_SECTION } from '@/lib/motivation-item-groups';

export interface StepDef {
  key: string;
  /** On the rail. Short enough to sit under a 28px circle. */
  label: string;
  /** The heading inside the step body. */
  title: string;
  blurb?: string;
  /** Registry section names, in the order they should appear. */
  sections: string[];
}

export const STEP_PLAN: StepDef[] = [
  {
    key: 'documents',
    label: 'Documents',
    title: 'Start with your documents',
    blurb:
      'This is the step that saves you the most typing — we read what we can off whatever you upload and fill the rest of the form in for you.',
    sections: ['The SAPS 271 form'],
  },
  {
    key: 'you',
    label: 'You & firearm',
    title: 'You and the firearm',
    // ⚠️ ORDER IS THE FEATURE. Operator, 2026-08-28: capture the firearm
    // "before the competency, that way the system can see which firearm it
    // is and link the correct competency and proficiency certificates".
    // Competency was part of 'About you' and therefore came first; it has
    // its own section now purely so it can sit on the far side of the
    // firearm without dragging name, ID and address along with it.
    sections: ['About you', 'The firearm', 'Your competency'],
  },
  {
    key: 'owned',
    label: 'What you own',
    title: 'Firearms you already own',
    sections: ['Firearms you already own'],
  },
  {
    key: 'record',
    label: 'Storage & record',
    title: 'Storage and your record',
    sections: ['Storage and safety', 'History'],
  },
  {
    key: 'case',
    label: 'Your case',
    title: 'Your case',
    sections: [
      'Dedicated status',
      'Your circumstances',
      'Experience',
      'The existing licence',
    ],
  },
  { key: 'prepare', label: 'Prepare', title: 'Prepare your pack', sections: [] },
];

/**
 * Which VAULT_PREFIXES entry a registry section reads from.
 *
 * ⚠️ THE SECTION NAMES ARE THE REGISTRY'S. A rename there without a rename
 * here silently returns nothing, which is the failure mode the prefix table
 * exists to make visible — so the mount site renders the panel with an empty
 * prefix list rather than a wrong one.
 *
 * ⚠️ IT LIVES BESIDE THE STEP PLAN so vault-prefix-coverage.spec.ts can hold
 * the LIVE wizard to the same promise it already held the pack screen to: a
 * prefix that matches no field on its own step ships a panel that computes
 * values, sends them to the browser, and filters every one of them out.
 */
export function vaultStepKey(section: string): string {
  if (section === OWNED_SECTION) return 'owned';
  if (section === 'Your competency') return 'competency';
  if (section === 'Dedicated status') return 'dedicated';
  return 'about';
}
