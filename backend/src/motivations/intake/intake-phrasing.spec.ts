import { MotivationLicenceType } from '@prisma/client';
import { MotivationIntakeService } from './intake.service';
import type { IntakeQuestion } from './intake.types';
import type { InterviewBrief } from './intake-brief';

const TYPE = MotivationLicenceType.S16_DEDICATED_HUNTER;

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

function question(
  fieldKey: string,
  overrides: Partial<IntakeQuestion> = {},
): IntakeQuestion {
  return {
    id: fieldKey,
    fieldKey,
    label: `Label for ${fieldKey}`,
    help: '',
    why: '',
    kind: 'short',
    choices: [],
    multi: false,
    sensitive: false,
    customPlaceholder: 'Or type your own answer…',
    progress: { answered: 0, total: 1 },
    optional: true,
    ...overrides,
  };
}

function brief(overrides: Partial<InterviewBrief> = {}): InterviewBrief {
  return {
    version: 'test',
    hash: 'h',
    at: new Date().toISOString(),
    facts: [],
    questions: [],
    chips: {},
    sources: [],
    researched: true,
    ...overrides,
  };
}

function makeService(reply: string, onComplete?: () => void) {
  const svc = Object.create(
    MotivationIntakeService.prototype,
  ) as MotivationIntakeService;
  let calls = 0;
  Object.assign(svc as unknown as Record<string, unknown>, {
    cardCache: new Map(),
    llm: {
      isConfiguredFor: () => true,
      complete: async () => {
        calls += 1;
        onComplete?.();
        return { text: reply };
      },
    },
    logger: { warn: () => undefined, log: () => undefined },
  });
  return { svc, calls: () => calls };
}

const ANSWERS = {
  firearm_type: 'Rifle',
  firearm_make: 'Tikka',
  firearm_calibre: '.30-06',
};

describe('wording a card', () => {
  it('costs no model call when every question is closed', async () => {
    const { svc, calls } = makeService('{}');
    const card = await (
      svc as unknown as {
        phrasedCard: (
          row: unknown,
          answers: Record<string, string>,
          previousAnswer: string | null,
          previousFieldKey: string | null,
          brief: InterviewBrief | null,
          bases: IntakeQuestion[],
        ) => Promise<{ questions: IntakeQuestion[] }>;
      }
    ).phrasedCard(ROW, ANSWERS, null, null, null, [
      question('firearm_type', { kind: 'choice' }),
      question('firearm_action', { kind: 'choice' }),
    ]);
    expect(calls()).toBe(0);
    expect(card.questions).toHaveLength(2);
  });

  it('words every open question in ONE call, and keeps the brief’s wording', async () => {
    const briefWithWording = brief({
      questions: [
        {
          fieldKey: 'firearm_make',
          question: 'Which make is your rifle?',
          why: 'The card prints it.',
          priority: 0,
        },
      ],
    });
    const { svc, calls } = makeService(
      JSON.stringify({
        questions: [
          {
            fieldKey: 'alternative_considered',
            question: 'What did you compare it with?',
          },
        ],
      }),
    );
    const card = await (
      svc as unknown as {
        phrasedCard: (
          row: unknown,
          answers: Record<string, string>,
          previousAnswer: string | null,
          previousFieldKey: string | null,
          brief: InterviewBrief | null,
          bases: IntakeQuestion[],
        ) => Promise<{ questions: IntakeQuestion[] }>;
      }
    ).phrasedCard(
      ROW,
      ANSWERS,
      null,
      null,
      briefWithWording,
      [
        question('firearm_make', {
          label: 'Which make is your rifle?',
          why: 'The card prints it.',
        }),
        question('alternative_considered'),
      ],
    );
    expect(calls()).toBe(1);
    expect(card.questions[0].label).toBe('Which make is your rifle?');
    expect(card.questions[1].label).toBe('What did you compare it with?');
  });

  it('ignores a field key the server did not ask for', async () => {
    const { svc } = makeService(
      JSON.stringify({
        questions: [
          { fieldKey: 'not_a_field', question: 'What is this?' },
        ],
      }),
    );
    const card = await (
      svc as unknown as {
        phrasedCard: (
          row: unknown,
          answers: Record<string, string>,
          previousAnswer: string | null,
          previousFieldKey: string | null,
          brief: InterviewBrief | null,
          bases: IntakeQuestion[],
        ) => Promise<{ questions: IntakeQuestion[] }>;
      }
    ).phrasedCard(ROW, ANSWERS, null, null, null, [
      question('alternative_considered', { label: 'What else did you consider?' }),
    ]);
    expect(card.questions[0].label).toBe('What else did you consider?');
  });

  it('never sends a sensitive question to the model', async () => {
    const { svc, calls } = makeService('{}');
    await (
      svc as unknown as {
        phrasedCard: (
          row: unknown,
          answers: Record<string, string>,
          previousAnswer: string | null,
          previousFieldKey: string | null,
          brief: InterviewBrief | null,
          bases: IntakeQuestion[],
        ) => Promise<{ questions: IntakeQuestion[] }>;
      }
    ).phrasedCard(ROW, ANSWERS, null, null, null, [
      question('firearm_serial', { kind: 'long', sensitive: true }),
    ]);
    expect(calls()).toBe(0);
  });

  it('serves the server’s wording when the model fails', async () => {
    const svc = Object.create(
      MotivationIntakeService.prototype,
    ) as MotivationIntakeService;
    Object.assign(svc as unknown as Record<string, unknown>, {
      cardCache: new Map(),
      llm: {
        isConfiguredFor: () => true,
        complete: async () => {
          throw new Error('down');
        },
      },
      logger: { warn: () => undefined, log: () => undefined },
    });
    const card = await (
      svc as unknown as {
        phrasedCard: (
          row: unknown,
          answers: Record<string, string>,
          previousAnswer: string | null,
          previousFieldKey: string | null,
          brief: InterviewBrief | null,
          bases: IntakeQuestion[],
        ) => Promise<{ questions: IntakeQuestion[] }>;
      }
    ).phrasedCard(ROW, ANSWERS, null, null, null, [
      question('alternative_considered', { label: 'What else did you consider?' }),
    ]);
    expect(card.questions[0].label).toBe('What else did you consider?');
  });
});
