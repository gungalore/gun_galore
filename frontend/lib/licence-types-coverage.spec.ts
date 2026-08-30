import { describe, expect, it } from 'vitest';
import SECTIONS from './__fixtures__/registry-sections.json';
import {
  LICENCE_LABEL,
  LICENCE_SECTION,
  LICENCE_TYPES,
  licenceLabel,
} from './licence-labels';

// ────────────────────────────────────────────────────────────────────
// THE CHOOSER OFFERS EVERY LICENCE TYPE, AND ONLY REAL ONES.
//
// ⚠️ THIS LIST IS NOW THE ONLY WAY TO START AN APPLICATION. It used to be one
// of three hand-synced copies of the same five values — app/motivations/page's
// LICENCE_TYPES, plus LICENCE_LABEL and LICENCE_SECTION in licence-labels —
// kept in step by a comment saying "if you change a label here, change it
// there too". They had already drifted once: one copy called S24 "Renewal",
// the other "Renewing an existing licence".
//
// The three are one list now, and the maps are computed from it. What that
// cannot catch is the direction the mistake actually comes from: somebody adds
// a sixth type to the Prisma enum and the server's registry, and this list
// does not grow. Before the merge that cost a label. Now it costs the ONLY
// door — the type would exist server-side, be applied for by nobody, and
// nothing would say so.
//
// The fixture is generated from the server's own fieldsFor(), which is the
// same source the wizard's own coverage guards use.
// ────────────────────────────────────────────────────────────────────

const REGISTRY_TYPES = Object.keys(SECTIONS);

describe('the licence types on offer', () => {
  it('⚠️ OFFERS EVERY TYPE THE SERVER HAS A FIELD REGISTRY FOR', () => {
    // A type the server can build an application for and the chooser never
    // shows is a section nobody can apply under.
    const offered = LICENCE_TYPES.map((t) => t.value);
    expect([...offered].sort()).toEqual([...REGISTRY_TYPES].sort());
  });

  it('⚠️ OFFERS NOTHING THE SERVER WOULD REFUSE', () => {
    // create() throws BadRequestException('Please choose a licence type.') for
    // a value outside the enum, so a stale option here is a card that fails
    // only once the member has committed to it.
    for (const t of LICENCE_TYPES) {
      expect(REGISTRY_TYPES).toContain(t.value);
    }
  });

  it('has no duplicate values', () => {
    const values = LICENCE_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('what each one says', () => {
  it('gives every option a label, a section and a blurb', () => {
    // An option rendering a blank line is indistinguishable from a broken one.
    for (const t of LICENCE_TYPES) {
      expect(t.label.trim(), `${t.value} label`).not.toBe('');
      expect(t.section.trim(), `${t.value} section`).not.toBe('');
      expect(t.blurb.trim(), `${t.value} blurb`).not.toBe('');
    }
  });

  it('⚠️ NAMES A SECTION OF THE ACT, NOT A NUMBER ON ITS OWN', () => {
    // "13" beside "Self-defence" reads as a quantity. The eyebrow is the
    // statutory reference and has to survive being read out of context.
    for (const t of LICENCE_TYPES) {
      expect(t.section, t.value).toMatch(/^Section \d+$/);
    }
  });

  it('⚠️ PROMISES NO OUTCOME ANYWHERE', () => {
    // The module's standing rule: we sell structure and completeness, never
    // odds. A blurb is the easiest place for that to slip in unnoticed.
    const forbidden =
      /\b(approv|guarantee|success|chance|likely|odds|best way|will get)/i;
    for (const t of LICENCE_TYPES) {
      expect(t.blurb, `${t.value} blurb`).not.toMatch(forbidden);
      expect(t.label, `${t.value} label`).not.toMatch(forbidden);
    }
  });
});

describe('the derived maps', () => {
  it('cover exactly the offered types', () => {
    const values = LICENCE_TYPES.map((t) => t.value).sort();
    expect(Object.keys(LICENCE_LABEL).sort()).toEqual(values);
    expect(Object.keys(LICENCE_SECTION).sort()).toEqual(values);
  });

  it('agree with the list they came from', () => {
    for (const t of LICENCE_TYPES) {
      expect(LICENCE_LABEL[t.value]).toBe(t.label);
      expect(LICENCE_SECTION[t.value]).toBe(t.section);
      expect(licenceLabel(t.value)).toBe(t.label);
    }
  });

  it('⚠️ FALLS BACK TO THE RAW VALUE, NEVER TO A BLANK', () => {
    // A type we do not recognise is a type somebody added to the backend enum
    // and not to this file. Printing the enum name is ugly and truthful; a
    // blank heading is neither.
    expect(licenceLabel('S99_NONSENSE')).toBe('S99_NONSENSE');
  });
});
