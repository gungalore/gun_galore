import { BadRequestException } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import { fieldByKey, fieldsFor } from '../motivation-fields';
import { MotivationIntakeService } from './intake.service';
import { pendingFields, planGroup } from './intake-planner';

const SHEET = {
  application: {
    id: 'mo-1',
    referenceNumber: 'MO1',
    licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
    licenceTypeLabel: 'Section 16',
    label: null,
    title: 'MO1',
    status: 'DRAFT',
    declarationAcceptedAt: null,
    templateLayout: null,
    templateColourway: null,
  },
  sections: [],
  items: [],
  documents: [],
  needs: { needs: [], missingRequired: [] },
  credentials: {},
  coverage: {},
  overlap: { verdict: { kind: 'none' }, prompt: null, suggestedAngle: null },
  preview: [],
  missing: [],
  ownedRows: [],
} as unknown as SheetResponse;

const ROW = {
  id: 'mo-1',
  referenceNumber: 'MO1',
  licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
  answersEncrypted: null,
  intakeMode: 'INTERVIEW',
  outputMode: 'MOTIVATION_ONLY',
  intakeStartedAt: new Date(),
  intakeDocumentsAt: new Date(),
  intakeCompletedAt: null,
  interviewEncrypted: null,
  answerProvenance: null,
  status: 'DRAFT',
};

/**
 * \u26a0\ufe0f ONLY THE COLLABORATORS THIS PATH TOUCHES. The real service fans out to
 * documents, the LLM and the pack; what is under test here is that a batch is
 * validated in full and written once, so the rest is stubbed and the state
 * rebuild is replaced.
 */
function makeService(answers: Record<string, string> = {}) {
  const svc = Object.create(
    MotivationIntakeService.prototype,
  ) as MotivationIntakeService;
  const writes: Record<string, string>[] = [];
  Object.assign(svc as unknown as Record<string, unknown>, {
    prisma: {
      motivation: {
        findFirst: async () => ROW,
        findUnique: async () => ROW,
        update: async () => ROW,
      },
    },
    sheets: { sheetFor: async () => SHEET },
    shared: {
      requireUser: async () => ({ id: 'user-1' }),
      answersFor: async () => answers,
    },
    documents: { library: async () => ({ items: [] }) },
    motivations: {
      saveAnswers: async (
        _u: string,
        _i: string,
        patch: Record<string, string>,
      ) => {
        writes.push(patch);
        return { refused: [] as string[] };
      },
      confirmAnswer: async () => undefined,
      autolink: async () => undefined,
    },
    agent: {
      phrase: async () => null,
      choicesFor: async () => [],
      extractFacts: async () => ({}),
    },
    llm: {
      isConfigured: () => false,
      isConfiguredFor: () => false,
      complete: async () => ({ text: '{}' }),
    },
    // A batch that ends the interview calls finish(), which now drafts first.
    drafts: {
      ensure: async () => ({ drafted: 0, failed: 0 }),
      ensureDeterministic: async () => ({ drafted: 0, failed: 0 }),
      isDrafting: () => false,
      ensureIfDrafted: async () => undefined,
    },
    logger: { warn: () => undefined, log: () => undefined },
    stateInternal: async () => ({ stage: 'INTERVIEW' }),
  });
  return { svc, writes };
}

describe('answering a group', () => {
  function identityKeys(): string[] {
    const group = planGroup({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {},
      sheet: SHEET,
    });
    return (group?.questions ?? []).map((q) => q.key).slice(0, 2);
  }

  it('writes every answer in one call', async () => {
    const { svc, writes } = makeService();
    const [first, second] = identityKeys();
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await svc.answerBatch('user-1', 'mo-1', [
      { fieldKey: first, value: 'Gerhard Fourie' },
      { fieldKey: second, value: '8001015009087' },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      [first]: 'Gerhard Fourie',
      [second]: '8001015009087',
    });
  });

  it('refuses a field outside the current group, and writes nothing', async () => {
    const { svc, writes } = makeService();
    const [first] = identityKeys();

    await expect(
      svc.answerBatch('user-1', 'mo-1', [
        { fieldKey: first, value: 'Gerhard Fourie' },
        { fieldKey: 'firearm_make', value: 'CZ' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  it('refuses the same field twice, and writes nothing', async () => {
    const { svc, writes } = makeService();
    const [first] = identityKeys();

    await expect(
      svc.answerBatch('user-1', 'mo-1', [
        { fieldKey: first, value: 'a' },
        { fieldKey: first, value: 'b' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  /**
   * ⚠️ A DATE SENT AS A TYPED MESSAGE IS STILL A DATE. The card used to post
   * the chosen date in `message`, which fell through to the chip matcher and
   * was refused with "choose one of the options" — so a date question could not
   * be saved at all. The card posts `value` now; this keeps the older bundle
   * working and closes the failure for good.
   */
  it('accepts a date sent as a typed message', async () => {
    const answers: Record<string, string> = {};
    for (const field of fieldsFor(MotivationLicenceType.S16_DEDICATED_HUNTER)) {
      answers[field.key] =
        field.key === 'shooting_history'
          ? Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
          : 'x';
    }
    delete answers.competency_issued;
    const { svc, writes } = makeService(answers);

    await svc.answerBatch('user-1', 'mo-1', [
      { fieldKey: 'competency_issued', message: '2020-01-01' },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ competency_issued: '2020-01-01' });
  });

  /**
   * ⚠️ AN ALTERNATIVE IS NOT THE FIREARM APPLIED FOR. MO000112's applied-for
   * make and model were filled with the Glock 42 from the applicant's answer
   * "I considered a Glock 42 but it was too bulky" — the cross-field extractor
   * read a rejected alternative as the choice.
   *
   * ⚠️ AND THE COMPARISON IS DRAFTED NOW (2026-11-27), so it is never on a card.
   * The guard still lives on the answer boundary because the review screen can
   * save an edited comparison, and the extractor must never treat it as the
   * applied-for firearm. This exercises that door directly.
   */
  it('never fills the applied-for firearm from the alternative considered', async () => {
    const answers: Record<string, string> = {};
    for (const field of fieldsFor(MotivationLicenceType.S16_DEDICATED_HUNTER)) {
      answers[field.key] = field.key === 'shooting_history' ? 'word '.repeat(20).trim() : 'x';
    }
    delete answers.alternative_considered;
    const { svc } = makeService(answers);
    const extract = jest.fn(async () => ({
      firearm_make: 'Glock',
      firearm_model: '42',
    }));
    (svc as unknown as { agent: { extractFacts: typeof extract } }).agent.extractFacts =
      extract;

    const current = {
      id: 'alternative_considered',
      fieldKey: 'alternative_considered',
      label: 'What else you considered, and why this one',
      help: '',
      kind: 'short' as const,
      choices: [],
      multi: false,
      sensitive: false,
      customPlaceholder: 'Or type your own answer…',
      progress: { answered: 0, total: 1 },
      optional: true,
    };
    const patch = await (
      svc as unknown as {
        patchForAnswer: (args: unknown) => Promise<Record<string, string>>;
      }
    ).patchForAnswer({
      row: ROW,
      sheet: SHEET,
      answers,
      current,
      key: 'alternative_considered',
      field: fieldByKey(
        MotivationLicenceType.S16_DEDICATED_HUNTER,
        'alternative_considered',
      ),
      body: {
        message: 'I considered a Glock 42 but it was a little too bulky',
      },
    });

    expect(extract).not.toHaveBeenCalled();
    expect(patch.alternative_considered).toContain('Glock 42');
    expect(patch).not.toHaveProperty('firearm_make');
    expect(patch).not.toHaveProperty('firearm_model');
  });

  /**
   * ⚠️ THE CHOSEN CARTRIDGE BECOMES THE CALIBRE WHEN THE TYPED ONE WAS A FAMILY.
   * Live app MO000159 stored calibre "6.5" + cartridge "6,5 Creedmoor"; every
   * downstream reader (species, labels, brief, fact pack) still saw the family.
   * The cartridge is the exact round and outranks the family — never a full
   * typed calibre.
   */
  it('writes the chosen cartridge into a bare-family calibre', async () => {
    const answers = { firearm_calibre: '6.5', firearm_type: 'Rifle' };
    const { svc } = makeService(answers);
    const patch = await (
      svc as unknown as {
        patchForAnswer: (args: unknown) => Promise<Record<string, string>>;
      }
    ).patchForAnswer({
      row: ROW,
      sheet: SHEET,
      answers,
      current: {
        id: 'firearm_cartridge',
        fieldKey: 'firearm_cartridge',
        label: 'Which cartridge is it?',
        help: '',
        kind: 'short',
        choices: [],
        multi: false,
        sensitive: false,
        customPlaceholder: 'Or type your own answer…',
        progress: { answered: 0, total: 1 },
        optional: true,
      },
      key: 'firearm_cartridge',
      field: fieldByKey(
        MotivationLicenceType.S16_DEDICATED_HUNTER,
        'firearm_cartridge',
      ),
      body: { value: '6,5 Creedmoor' },
    });

    expect(patch.firearm_cartridge).toBe('6,5 Creedmoor');
    expect(patch.firearm_calibre).toBe('6,5 Creedmoor');
  });

  it('never overwrites a full typed calibre with the cartridge', async () => {
    const answers = { firearm_calibre: '.308 Winchester' };
    const { svc } = makeService(answers);
    const patch = await (
      svc as unknown as {
        patchForAnswer: (args: unknown) => Promise<Record<string, string>>;
      }
    ).patchForAnswer({
      row: ROW,
      sheet: SHEET,
      answers,
      current: {
        id: 'firearm_cartridge',
        fieldKey: 'firearm_cartridge',
        label: 'Which cartridge is it?',
        help: '',
        kind: 'short',
        choices: [],
        multi: false,
        sensitive: false,
        customPlaceholder: 'Or type your own answer…',
        progress: { answered: 0, total: 1 },
        optional: true,
      },
      key: 'firearm_cartridge',
      field: fieldByKey(
        MotivationLicenceType.S16_DEDICATED_HUNTER,
        'firearm_cartridge',
      ),
      body: { value: '.308 Win' },
    });

    expect(patch.firearm_cartridge).toBe('.308 Win');
    expect(patch).not.toHaveProperty('firearm_calibre');
  });

  /**
   * ⚠️ THE EXTRACTOR NEVER "UPGRADES" A TYPED CALIBRE — THE SHEET ASKS.
   *
   * The cross-field extractor reads a typed sentence for facts about other
   * fields. For the calibre that used to mean a typed family could be replaced
   * by a variant the model inferred, which defeats the cartridge question: the
   * applicant must choose the round. "6.5 mm" is a multi-word family, so it
   * passes the "more than one word" gate into the extractor; the guard drops
   * the extracted variant and the typed text is what is stored. The follow-up
   * question is then pending, per the sheet.
   */
  it('never lets the extractor expand a typed calibre family', async () => {
    const answers: Record<string, string> = {
      full_name: 'A B',
      id_number: '8001015009087',
      licence_holder_type: 'Main firearm licence holder',
      occupation: 'Engineer',
      marital_status: 'Married',
      spouse_name: 'C D',
      firearm_type: 'Rifle',
      firearm_action: 'Bolt action',
      firearm_make: 'Tikka',
      firearm_model: 'T3x',
      firearm_serial: 'S1',
    };
    const { svc, writes } = makeService(answers);
    const extract = jest.fn(async () => ({
      firearm_calibre: '6.5 Creedmoor',
    }));
    (svc as unknown as { agent: { extractFacts: typeof extract } }).agent.extractFacts =
      extract;

    await svc.answerBatch('user-1', 'mo-1', [
      { fieldKey: 'firearm_calibre', value: '6.5 mm' },
    ]);

    expect(extract).toHaveBeenCalled();
    expect(writes[0].firearm_calibre).toBe('6.5 mm');
    // ...and the cartridge question is then the outstanding one, not a silent
    // expansion: the sheet builds the item, the planner offers the choices.
    const withItem = {
      ...SHEET,
      items: [
        {
          key: 'firearm_cartridge',
          label: 'Which cartridge is it?',
          kind: 'short',
          state: 'needs_you',
          value: '',
          provenance: null,
          section: 'firearm',
          scope: 'application',
          required: false,
          choices: ['6,5 Creedmoor', '6.5x55 Swedish', '6.5 PRC'],
        },
      ],
    } as unknown as SheetResponse;
    const pending = pendingFields({
      type: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: { ...answers, firearm_calibre: '6.5 mm' },
      sheet: withItem,
    }).map((entry) => entry.key);
    expect(pending).toContain('firearm_cartridge');
  });
});
