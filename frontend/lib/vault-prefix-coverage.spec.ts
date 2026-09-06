import { describe, expect, it } from 'vitest';
import KEYS from './__fixtures__/registry-keys.json';
import { VAULT_PREFIXES } from '@/app/licence-services/[id]/vault-prefixes';
import { WIZARD_STEPS } from '@/components/licence-pack/wizard-rail';
import { STEP_PLAN, vaultStepKey } from '@/lib/motivation-step-plan';

// ────────────────────────────────────────────────────────────────────
// A VAULT OFFER THAT MATCHES NOTHING IS SILENT, NOT BROKEN.
//
// ⚠️ THIS EXACT BUG RAN FOR MONTHS ON THE OLD PAGE. LicenceCentreOfferPanel
// was mounted on the "About you" section and handed the key prefix
// `association_` — but the association fields live in their own "Dedicated
// status" section and always had. So the server computed the offer, shipped
// every value to the browser, and the panel filtered all of them out against a
// section that could not contain them. Nothing errored. Nothing logged. The
// dedicated-status half of the Document Centre simply never appeared, and the
// only symptom was a member being asked for something we were holding.
//
// The prefixes now live beside the step that owns them, which removes the
// drift at its source. This removes the rest: a prefix that matches no field
// in that step's own sections cannot ship.
// ────────────────────────────────────────────────────────────────────

type Field = { key: string; section: string };
const TYPES = Object.keys(KEYS) as (keyof typeof KEYS)[];

// ────────────────────────────────────────────────────────────────────
// ⚠️ TWO WIZARDS MOUNT THIS PANEL, AND ONLY ONE WAS GUARDED.
//
// The table is shared — the live wizard at /motivations/[id] has imported
// VAULT_PREFIXES since 2026-09-06 — but it resolves a step differently: the
// pack screen mounts the panel per STEP and hands it that step's prefixes,
// while the live wizard mounts it per SECTION and looks the bucket up through
// `vaultStepKey`. So the same prefix can match on one screen and match nothing
// on the other, which is exactly the silent failure this file exists for. Both
// mappings are asserted below.
// ────────────────────────────────────────────────────────────────────

/** Which sections a screen shows the vault panel on, for a given bucket. */
const SCREENS: { name: string; sectionsFor: (bucket: string) => Set<string> }[] =
  [
    {
      name: 'the pack wizard (/licence-services/[id])',
      sectionsFor: (bucket) =>
        new Set(WIZARD_STEPS.find((s) => s.key === bucket)?.sections ?? []),
    },
    {
      name: 'the live wizard (/motivations/[id])',
      // Every registry section this wizard renders, kept only where it reads
      // from the bucket in question.
      sectionsFor: (bucket) =>
        new Set(
          STEP_PLAN.flatMap((s) => s.sections).filter(
            (sec) => vaultStepKey(sec) === bucket,
          ),
        ),
    },
  ];

/** Every field key that appears in a given step's sections, any licence type. */
function keysForStep(stepKey: string, screen = SCREENS[0]): string[] {
  const sections = screen.sectionsFor(stepKey);
  const out = new Set<string>();
  for (const t of TYPES) {
    for (const f of KEYS[t] as unknown as Field[]) {
      if (sections.has(f.section)) out.add(f.key);
    }
  }
  return [...out];
}

describe('⚠️ every vault prefix matches a field on its own step', () => {
  it('reads the registry for all five licence types', () => {
    // If the fixture is stale, every assertion below passes for the wrong
    // reason.
    expect(TYPES).toHaveLength(5);
  });

  it('names only steps that exist in the rail', () => {
    const real = new Set(WIZARD_STEPS.map((s) => s.key));
    const unknown = Object.keys(VAULT_PREFIXES).filter((k) => !real.has(k));
    expect(unknown).toEqual([]);
  });

  for (const screen of SCREENS) {
    it.each(Object.keys(VAULT_PREFIXES))(
      `${screen.name} · %s — no prefix matches nothing`,
      (stepKey) => {
        const keys = keysForStep(stepKey, screen);
        const dead = (VAULT_PREFIXES[stepKey] ?? []).filter(
          (prefix) => !keys.some((k) => k.startsWith(prefix)),
        );
        // Named, not counted: the failure has to say WHICH prefix is dead, or
        // it is as silent as the bug it exists to prevent.
        expect({ stepKey, dead }).toEqual({ stepKey, dead: [] });
      },
    );
  }

  it('⚠️ THE DEDICATED-STATUS PREFIX RESOLVES, which it did not for months', () => {
    // The original bug, asserted by name so nobody reintroduces it by moving
    // the fields and leaving the prefix behind.
    const keys = keysForStep('dedicated');
    expect(keys.some((k) => k.startsWith('association_'))).toBe(true);
  });

  it.each(SCREENS.map((s) => s.name))(
    '%s — does not offer a step vault values belonging to another step',
    (name) => {
    // A prefix on "about" that matched a competency field would fill a box
    // the member cannot see from there — the answer is saved into a screen
    // they are not looking at.
    const screen = SCREENS.find((s) => s.name === name)!;
    for (const [stepKey, prefixes] of Object.entries(VAULT_PREFIXES)) {
      const mine = new Set(keysForStep(stepKey, screen));
      for (const prefix of prefixes ?? []) {
        const strays = TYPES.flatMap((t) =>
          (KEYS[t] as unknown as Field[])
            .filter((f) => f.key.startsWith(prefix) && !mine.has(f.key))
            .map((f) => `${f.key} (${f.section})`),
        );
        expect({ stepKey, prefix, strays: [...new Set(strays)] }).toEqual({
          stepKey,
          prefix,
          strays: [],
        });
      }
    }
  },
  );
});
