import {
  blockThreshold,
  contactQuestions,
  JEV_CATEGORY_REASONS,
  jevLadder,
  reviewThreshold,
} from './jev-battery';

type DecideArgs = {
  questions: Record<string, unknown>;
};
type CompleteArgs = { system?: string; messages: Array<{ content: unknown }> };

/** A fake LlmService good enough for the ladder. */
function fakeLlm(opts: {
  noul?: Record<string, number>;
  decideThrows?: boolean;
  escalate?: string;
}) {
  return {
    decide: async (_args: DecideArgs) => {
      if (opts.decideThrows) throw new Error('down');
      const answers: Record<string, unknown> = {};
      for (const id of Object.keys(opts.noul ?? {})) {
        answers[id] = { type: 'noul', noul: opts.noul![id] };
      }
      return { model: 'jev-1.13.0', answers, usage: { inputTokens: 1, outputTokens: 0 } };
    },
    complete: async (_args: CompleteArgs) => ({ text: opts.escalate ?? '{"decision":"UNSURE"}' }),
  } as never;
}

function run(opts: Parameters<typeof fakeLlm>[0], onError: 'pass' | 'review' | 'block' = 'review') {
  return jevLadder(fakeLlm(opts), {
    state: 'text',
    questions: contactQuestions(),
    reasons: JEV_CATEGORY_REASONS,
    purpose: 'test',
    onError,
  });
}

const prevBlock = process.env.JEV_BLOCK_THRESHOLD;
const prevReview = process.env.JEV_REVIEW_THRESHOLD;

afterAll(() => {
  if (prevBlock === undefined) delete process.env.JEV_BLOCK_THRESHOLD;
  else process.env.JEV_BLOCK_THRESHOLD = prevBlock;
  if (prevReview === undefined) delete process.env.JEV_REVIEW_THRESHOLD;
  else process.env.JEV_REVIEW_THRESHOLD = prevReview;
});

describe('jevLadder', () => {
  it('defaults to an 80/60 ladder', () => {
    delete process.env.JEV_BLOCK_THRESHOLD;
    delete process.env.JEV_REVIEW_THRESHOLD;
    expect(blockThreshold()).toBe(0.8);
    expect(reviewThreshold()).toBe(0.6);
  });

  it('blocks when Jev is at or above the block threshold', async () => {
    const v = await run({ noul: { contact_details: 0.9 } });
    expect(v.decision).toBe('BLOCK');
    expect(v.category).toBe('contact_details');
    expect(v.reason).toContain('phone');
    expect(v.escalated).toBe(false);
  });

  it('passes below the review threshold', async () => {
    const v = await run({ noul: { contact_details: 0.2 } });
    expect(v.decision).toBe('PASS');
  });

  it('escalates the 60–80 band and blocks on a DeepSeek VIOLATION', async () => {
    const v = await run({
      noul: { social_handles: 0.7 },
      escalate: '{"decision":"VIOLATION"}',
    });
    expect(v.decision).toBe('BLOCK');
    expect(v.escalated).toBe(true);
    expect(v.source).toBe('deepseek');
  });

  it('escalates the 60–80 band and passes on a DeepSeek CLEAN', async () => {
    const v = await run({
      noul: { social_handles: 0.7 },
      escalate: '{"decision":"CLEAN"}',
    });
    expect(v.decision).toBe('PASS');
    expect(v.escalated).toBe(true);
  });

  it('sends an unsure escalation to admin review', async () => {
    const v = await run({
      noul: { social_handles: 0.7 },
      escalate: '{"decision":"UNSURE"}',
    });
    expect(v.decision).toBe('REVIEW');
    expect(v.category).toBe('social_handles');
  });

  it('treats an unparseable escalation as unsure', async () => {
    const v = await run({ noul: { social_handles: 0.7 }, escalate: 'not json' });
    expect(v.decision).toBe('REVIEW');
  });

  it('honours the fail posture on a Jev outage', async () => {
    expect((await run({ decideThrows: true }, 'pass')).decision).toBe('PASS');
    expect((await run({ decideThrows: true }, 'review')).decision).toBe('REVIEW');
    expect((await run({ decideThrows: true }, 'block')).decision).toBe('BLOCK');
  });
});

describe('contactQuestions', () => {
  it('asks exactly the six contact categories', () => {
    expect(Object.keys(contactQuestions()).sort()).toEqual(
      [
        'contact_details',
        'offplatform_coordination',
        'physical_address',
        'real_name',
        'social_handles',
        'third_party_advertising',
      ].sort(),
    );
  });
});
