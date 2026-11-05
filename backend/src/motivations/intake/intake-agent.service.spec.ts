import type { LlmService } from '../../common/llm/llm.service';
import type { LlmAgentRequest } from '../../common/llm/llm.types';
import {
  MotivationIntakeAgentService,
  type InterviewAgentContext,
} from './intake-agent.service';

function context(): InterviewAgentContext {
  return {
    licenceType: 'S15_OCCASIONAL_HUNTER',
    licenceLabel: 'Section 15 — occasional hunter',
    summary: 'A short, plain interview.',
    knownFacts: ['Rifle', '.30-06 Springfield'],
    question: {
      id: 'intended_quarry',
      fieldKey: 'intended_quarry',
      label: 'What do you hunt?',
      help: 'Name the species you actually hunt.',
      kind: 'multi',
      choices: [
        { value: 'kudu', label: 'Kudu' },
        { value: 'impala', label: 'Impala' },
      ],
      multi: true,
      sensitive: false,
      customPlaceholder: 'Or type another species',
      progress: { answered: 3, total: 12 },
      optional: false,
    },
    documents: {
      items: [],
      missing: [],
      needs: [],
      attached: 1,
      required: 0,
      sourceProofAttached: true,
      firearmKnown: true,
    },
    evidence: {
      items: [],
      groups: ['hunting'],
      note: 'Add hunting photographs if you have them.',
      ready: true,
    },
    previousAnswer: 'I hunt on a family farm.',
  };
}

function fakeLlm(
  handler: (req: LlmAgentRequest) => Promise<unknown>,
): LlmService {
  return {
    isConfiguredFor: () => true,
    agent: handler,
  } as unknown as LlmService;
}

describe('the interview agent', () => {
  it('reads the application through a tool and returns the next question', async () => {
    let sawContext: Record<string, unknown> | null = null;
    const llm = fakeLlm(async (req) => {
      const tool = await req.executeTool({
        id: 'call-1',
        name: 'get_interview_context',
        input: {},
      });
      sawContext = tool as Record<string, unknown>;
      return {
        text: JSON.stringify({
          acknowledgement: 'That gives the farm context.',
          question: 'Which species do you actually hunt there?',
        }),
        toolCalls: [
          {
            id: 'call-1',
            name: 'get_interview_context',
            input: {},
          },
        ],
        usage: { inputTokens: 40, outputTokens: 12 },
        model: 'gemini-3.1-flash-lite',
        provider: 'gemini',
        interactionId: 'interaction-1',
        rounds: 2,
      };
    });

    const reply = await new MotivationIntakeAgentService(llm).phrase(context());

    expect(reply).toEqual({
      acknowledgement: 'That gives the farm context.',
      question: 'Which species do you actually hunt there?',
      toolsUsed: ['get_interview_context'],
    });
    expect(sawContext).toMatchObject({
      licenceLabel: 'Section 15 — occasional hunter',
      question: { fieldKey: 'intended_quarry' },
      documents: { sourceProofAttached: true },
    });
  });

  it('parses dynamically generated choices and caps at 5', async () => {
    const llm = fakeLlm(async () => ({
      text: JSON.stringify({
        question: 'What is your primary risk for self-defence?',
        choices: [
          { value: 'Late travel', label: 'Late-night travel on rural roads' },
          { value: 'Cash carrying', label: 'Carrying cash for business' },
          { value: 'Isolated home', label: 'Isolated smallholding with dependants' },
          { value: 'High crime area', label: 'High-crime residential area' },
          { value: 'Recent robbery', label: 'Recent break-in attempt' },
          { value: 'Excess choice', label: 'Should be dropped by cap' },
        ],
      }),
      toolCalls: [],
      usage: { inputTokens: 20, outputTokens: 20 },
      model: 'gemini-3.1-flash-lite',
      provider: 'gemini',
      interactionId: 'interaction-choices',
      rounds: 1,
    }));

    const reply = await new MotivationIntakeAgentService(llm).phrase(context());

    expect(reply).not.toBeNull();
    expect(reply?.choices).toHaveLength(5);
    expect(reply?.choices?.[0]).toEqual({
      value: 'Late travel',
      label: 'Late-night travel on rural roads',
    });
    expect(reply?.choices?.map((c) => c.value)).not.toContain('Excess choice');
  });

  it('does not turn a malformed model answer into a question', async () => {
    const llm = fakeLlm(async () => ({
      text: 'not json',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'gemini-3.1-flash-lite',
      provider: 'gemini',
      interactionId: 'interaction-2',
      rounds: 1,
    }));

    const reply = await new MotivationIntakeAgentService(llm).phrase(context());

    expect(reply).toBeNull();
  });

  it('stays out of the way when Gemini is not configured', async () => {
    const llm = {
      isConfiguredFor: () => false,
      agent: jest.fn(),
    } as unknown as LlmService;

    const reply = await new MotivationIntakeAgentService(llm).phrase(context());

    expect(reply).toBeNull();
    expect(llm.agent).not.toHaveBeenCalled();
  });
});

describe('the fact extractor', () => {
  const candidates = [
    { key: 'firearm_make', label: 'Make', kind: 'short' },
    { key: 'firearm_model', label: 'Model', kind: 'short' },
    { key: 'firearm_calibre', label: 'Calibre', kind: 'short' },
    {
      key: 'firearm_type',
      label: 'Type',
      kind: 'choice',
      choices: [
        { value: 'Rifle', label: 'Rifle' },
        { value: 'Handgun', label: 'Handgun' },
      ],
    },
    { key: 'licence_expiry', label: 'Expiry', kind: 'date' },
  ];

  function extractorLlm(text: string, extra: Partial<Record<string, unknown>> = {}) {
    return {
      isConfiguredFor: () => true,
      complete: async () => ({ text }),
      ...extra,
    } as unknown as LlmService;
  }

  it('turns one sentence into every fact it actually states', async () => {
    const llm = extractorLlm(
      JSON.stringify({
        answers: [
          { key: 'firearm_make', value: 'Mauser' },
          { key: 'firearm_model', value: 'M96' },
          { key: 'firearm_calibre', value: '.30-06 Springfield' },
          { key: 'firearm_type', value: 'rifle' },
          { key: 'firearm_serial', value: 'NOT-A-CANDIDATE' },
        ],
      }),
    );

    const out = await new MotivationIntakeAgentService(llm).extractFacts({
      text: 'Mauser M96 straight-pull in .30-06 Springfield, a rifle.',
      currentKey: 'firearm_make',
      candidates,
    });

    expect(out).toEqual({
      firearm_make: 'Mauser',
      firearm_model: 'M96',
      firearm_calibre: '.30-06 Springfield',
      firearm_type: 'Rifle',
    });
  });

  it('drops a value outside a closed choice and a malformed date', async () => {
    const llm = extractorLlm(
      JSON.stringify({
        answers: [
          { key: 'firearm_type', value: 'Shotgun' },
          { key: 'licence_expiry', value: 'next June' },
        ],
      }),
    );

    const out = await new MotivationIntakeAgentService(llm).extractFacts({
      text: 'It is a shotgun that expires next June.',
      currentKey: 'firearm_type',
      candidates,
    });

    expect(out).toEqual({});
  });
});

describe('the chips turn', () => {
  function chipLlm(text: string) {
    return {
      isConfiguredFor: () => true,
      complete: async () => ({ text }),
    } as unknown as LlmService;
  }

  const ask = (llm: LlmService) =>
    new MotivationIntakeAgentService(llm).choicesFor({
      licenceLabel: 'Section 15 — occasional hunter',
      question: 'What do you hunt?',
      help: 'Name the species you actually hunt.',
      known: ['Rifle', '.30-06 Springfield'],
    });

  it('returns the answers it was given, capped and de-duplicated', async () => {
    const llm = chipLlm(
      JSON.stringify({
        choices: [
          { value: 'Kudu', label: 'Kudu' },
          { value: 'kudu.', label: 'Kudu' },
          { value: 'Blue wildebeest', label: 'Blue wildebeest' },
          { value: 'Impala', label: 'Impala' },
        ],
      }),
    );

    expect(await ask(llm)).toEqual([
      { value: 'Kudu', label: 'Kudu' },
      { value: 'Blue wildebeest', label: 'Blue wildebeest' },
      { value: 'Impala', label: 'Impala' },
    ]);
  });

  // ⚠️ One button is a leading question, not a shortlist — the caller keeps its
  // text box instead.
  it('returns nothing when fewer than two answers survive', async () => {
    const llm = chipLlm(JSON.stringify({ choices: [{ value: 'Kudu' }] }));
    expect(await ask(llm)).toEqual([]);
  });

  it('returns nothing when the model is unavailable', async () => {
    const llm = {
      isConfiguredFor: () => false,
      complete: async () => ({ text: '{}' }),
    } as unknown as LlmService;
    expect(await ask(llm)).toEqual([]);
  });

  it('returns nothing when the turn throws', async () => {
    const llm = {
      isConfiguredFor: () => true,
      complete: async () => {
        throw new Error('timeout');
      },
    } as unknown as LlmService;
    expect(await ask(llm)).toEqual([]);
  });
});