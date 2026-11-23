import {
  blockThreshold,
  contactQuestions,
  faqQuestions,
  JEV_CATEGORY_REASONS,
  jevLadder,
  reviewThreshold,
} from './jev-battery';

type DecideArgs = {
  questions: Record<string, unknown>;
};

/** A fake LlmService good enough for the ladder. `complete` must never run:
 *  the 60–80 % band is a human-review handoff, not a second-model call. */
function fakeLlm(opts: {
  noul?: Record<string, number>;
  decideThrows?: boolean;
}) {
  const complete = jest.fn(async () => {
    throw new Error('the ladder must not call a second model');
  });
  const llm = {
    decide: async (_args: DecideArgs) => {
      if (opts.decideThrows) throw new Error('down');
      const answers: Record<string, unknown> = {};
      for (const id of Object.keys(opts.noul ?? {})) {
        answers[id] = { type: 'noul', noul: opts.noul![id] };
      }
      return {
        model: 'jev-1.13.0',
        answers,
        usage: { inputTokens: 1, outputTokens: 0 },
      };
    },
    complete,
  } as never;
  return { llm, complete };
}

function run(
  opts: Parameters<typeof fakeLlm>[0],
  onError: 'pass' | 'review' | 'block' = 'review',
) {
  return jevLadder(fakeLlm(opts).llm, {
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
    expect(v.source).toBe('jev');
  });

  it('passes below the review threshold', async () => {
    const v = await run({ noul: { contact_details: 0.2 } });
    expect(v.decision).toBe('PASS');
  });

  it('⚠️ holds the 60–80 band for a human and calls no second model', async () => {
    const { llm, complete } = fakeLlm({ noul: { social_handles: 0.7 } });
    const v = await jevLadder(llm, {
      state: 'text',
      questions: contactQuestions(),
      reasons: JEV_CATEGORY_REASONS,
      purpose: 'test',
      onError: 'review',
    });
    expect(v.decision).toBe('REVIEW');
    expect(v.category).toBe('social_handles');
    expect(v.source).toBe('jev');
    expect(complete).not.toHaveBeenCalled();
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

describe('faqQuestions', () => {
  it('asks one duplicate question and nothing that could block a message', () => {
    const q = faqQuestions();
    expect(Object.keys(q)).toEqual(['faq_duplicate']);
    expect(q.faq_duplicate.type).toBe('noul');
    expect(q.faq_duplicate.instructions).toMatch(/FULLY answer/i);
  });
});
