import { BadRequestException, ConflictException } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import type { SheetResponse } from '../motivation-sheet.service';
import { fieldsFor } from '../motivation-fields';
import { MotivationIntakeService } from './intake.service';

const TYPE = MotivationLicenceType.S16_DEDICATED_HUNTER;

const SHEET = {
  application: {
    id: 'mo-1',
    referenceNumber: 'MO1',
    licenceType: TYPE,
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
  licenceType: TYPE,
  answersEncrypted: null,
  intakeMode: 'INTERVIEW',
  outputMode: 'MOTIVATION_ONLY',
  intakeStartedAt: new Date(),
  intakeDocumentsAt: new Date(),
  intakeCompletedAt: null,
  interviewEncrypted: null,
  answerProvenance: null,
  status: 'DRAFT',
  intakeBriefEncrypted: null,
  intakeBriefVersion: null,
  intakeBriefHash: null,
  intakeBriefAt: null,
};

/** Every question answered except the optional one under test. */
function answersExcept(...keep: string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const field of fieldsFor(TYPE)) {
    if (keep.includes(field.key)) continue;
    answers[field.key] =
      field.key === 'shooting_history'
        ? Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
        : 'x';
  }
  // The safe follow-ups are showIf children of this one; keep the door open so
  // a required safe question is genuinely on the card.
  if (!keep.includes('safe_present')) answers.safe_present = 'Yes';
  return answers;
}

function makeService(answers: Record<string, string>) {
  const skipped: string[] = [];
  const svc = Object.create(
    MotivationIntakeService.prototype,
  ) as MotivationIntakeService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    prisma: { motivation: { findFirst: async () => ROW } },
    sheets: { sheetFor: async () => SHEET },
    shared: {
      requireUser: async () => ({ id: 'user-1' }),
      answersFor: async () => answers,
      readAnswers: () => answers,
    },
    documents: { library: async () => ({ items: [] }) },
    motivations: {
      skipAnswer: async (_u: string, _i: string, key: string) => {
        skipped.push(key);
      },
    },
    llm: { isConfigured: () => false, isConfiguredFor: () => false },
    logger: { warn: () => undefined, log: () => undefined },
    state: async () => ({ stage: 'INTERVIEW' }),
  });
  return { svc, skipped };
}

describe('skipping an optional question', () => {
  it('settles an optional case question the member does not want to answer', async () => {
    const answers = answersExcept('alarm_present');
    const { svc, skipped } = makeService(answers);
    const state = await svc.skip('user-1', 'mo-1', 'alarm_present');
    expect(state).toEqual({ stage: 'INTERVIEW' });
    expect(skipped).toEqual(['alarm_present']);
  });

  it('refuses to skip a required question', async () => {
    const answers = answersExcept('safe_type');
    const { svc, skipped } = makeService(answers);
    await expect(
      svc.skip('user-1', 'mo-1', 'safe_type'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(skipped).toEqual([]);
  });

  it('refuses a question that is not on the current card', async () => {
    const answers = answersExcept('alarm_present');
    const { svc, skipped } = makeService(answers);
    await expect(
      svc.skip('user-1', 'mo-1', 'firearm_make'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(skipped).toEqual([]);
  });

  it('refuses a skip before the interview starts', async () => {
    const answers = answersExcept('alarm_present');
    const { svc } = makeService(answers);
    Object.assign(svc as unknown as Record<string, unknown>, {
      prisma: {
        motivation: {
          findFirst: async () => ({ ...ROW, intakeMode: null }),
        },
      },
    });
    await expect(
      svc.skip('user-1', 'mo-1', 'alarm_present'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
