import { MotivationLicenceType } from '@prisma/client';
import {
  FactPack,
  gateSystemPrompt,
  gateUserPrompt,
  generationSystemPrompt,
  generationUserPrompt,
} from './motivation-prompts';
import { planFor } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// THE PROMPTS ARE A SPEC, NOT A CHANGELOG.
//
// ⚠️ THE FAULT THIS EXISTS TO PREVENT. Roughly a third of the writer prompt
// was once decision history — what a rule used to say, which draft provoked
// it, what the operator decided on which date. A model reading "this rule said
// the opposite until now" has TWO rules in front of it and follows the most
// recent concrete instruction, which is how a document came back arguing a
// product page in a self-defence motivation. The history now lives in the
// JSDoc comments above each constant, where the model never sees it.
//
// This asserts on the RENDERED prompt — what the provider actually receives —
// so a history fragment re-entering any string fails here, however it got in.
// ────────────────────────────────────────────────────────────────────

const TYPES = Object.values(MotivationLicenceType) as MotivationLicenceType[];

/** Phrases that mean "this prompt is carrying decision history". */
const HISTORY_MARKERS: { name: string; re: RegExp }[] = [
  { name: 'until now', re: /until now/i },
  { name: 'previously:', re: /previously:/i },
  { name: 'earlier version', re: /earlier version/i },
  { name: 'worked example', re: /worked example/i },
  { name: 'operator decision', re: /operator decision/i },
  { name: 'said the opposite', re: /said the opposite/i },
  { name: 'used to say', re: /used to say/i },
  { name: 'MO reference', re: /\bMO\d{6}\b/ },
  { name: 'operator quote', re: /Operator,\s*20\d\d/ },
];

/** A pack rich enough that every per-applicant block renders. */
function pack(licenceType: MotivationLicenceType): FactPack {
  return {
    licenceType,
    answers: {
      full_name: 'Jan Pietersen',
      id_number: '8001015009087',
      firearm_type: 'Handgun',
      firearm_make: 'Glock',
      firearm_model: '19',
      firearm_calibre: '9mm',
      firearm_serial: 'ABC123',
      firearm_fit_reason: 'The low recoil suits the volume of practice I need.',
    },
    derived: { age: '43' },
    overlapNote: 'The applicant already holds a handgun under section 13.',
    research: 'Precinct crime figures for the area, from published sources.',
    annexures: [{ letter: 'A', label: 'Identity Document' }],
    arsenal: [
      {
        index: 1,
        make: 'Mauser',
        model: '',
        type: 'Rifle',
        calibre: '.30-06 Springfield',
        serial: '96008993',
        section: 'section 16',
        licensedFor: 'Dedicated hunting',
        expires: '2034-10-28',
        line: 'Mauser .30-06 Springfield, serial 96008993, section 16, dedicated hunting',
      },
    ],
  };
}

function assertNoHistory(where: string, text: string): void {
  for (const { name, re } of HISTORY_MARKERS) {
    expect({ where, marker: name, hit: re.test(text) }).toEqual({
      where,
      marker: name,
      hit: false,
    });
  }
}

describe('motivation prompts — a spec, not a changelog', () => {
  it('the writer system prompt carries no decision history', () => {
    for (const t of TYPES) {
      assertNoHistory(`system:${t}`, generationSystemPrompt(t));
    }
  });

  it('the writer user prompt carries no decision history', () => {
    for (const t of TYPES) {
      assertNoHistory(
        `user:${t}`,
        generationUserPrompt(pack(t), planFor(t, 7)),
      );
    }
  });

  it('the gate prompts carry no decision history', () => {
    assertNoHistory('gate-system', gateSystemPrompt());
    for (const t of TYPES) {
      assertNoHistory(
        `gate-user:${t}`,
        gateUserPrompt(pack(t), 'Draft body.'),
      );
    }
  });

  it('the writer system prompt carries no ISO date of its own', () => {
    // The statute block is sent separately and legitimately carries the Act's
    // own dates; the SYSTEM prompt is a pure function of the licence type and
    // has no business naming a day.
    for (const t of TYPES) {
      expect(generationSystemPrompt(t)).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  it('hands the writer the arsenal whenever the applicant holds firearms', () => {
    for (const t of TYPES) {
      const p = generationUserPrompt(pack(t), planFor(t, 7));
      expect(p).toContain('<arsenal>');
      expect(p).toContain('96008993');
    }
  });
});
