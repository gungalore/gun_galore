import { BadRequestException } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import { MotivationIntakeService } from './intake.service';
import { planGroup } from './intake-planner';

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
function makeService() {
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
      answersFor: async () => ({}),
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
});
