import { ContactDetailFilterService } from './contact-detail-filter.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * REVIEWS HAVE NO ADMIN REVIEW SCREEN (operator, 2026-11-27): "Let JEV also do
 * abuse filter, negative feedback is allowed but derogatory language and
 * references are forbidden. No admin screen, just let JEV do it."
 *
 * The Jev ladder's 60–80 % band normally passes the text and parks it for a
 * human. On rating comments and seller replies the caller asks for
 * `blockOnReview`, so that band becomes a rejection with a "please rephrase it"
 * reason. Every other surface keeps the old behaviour.
 * ────────────────────────────────────────────────────────────────────────────
 */
function build(noul: Record<string, number>) {
  const svc = Object.create(
    ContactDetailFilterService.prototype,
  ) as ContactDetailFilterService;
  const rejected: Record<string, unknown>[] = [];
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    llm: {
      decide: jest.fn(async () => ({
        model: 'jev-1.13.0',
        answers: Object.fromEntries(
          Object.entries(noul).map(([id, value]) => [id, { type: 'noul', noul: value }]),
        ),
        usage: { inputTokens: 1, outputTokens: 0 },
      })),
    },
    persistRejection: jest.fn(
      async (
        text: string,
        channel: string,
        category: string,
        userId?: string,
      ) => {
        rejected.push({ text, channel, category, userId });
      },
    ),
  });
  return { svc, rejected };
}

describe('a derogatory review is rejected', () => {
  it('blocks a protected-class slur above the block threshold', async () => {
    const { svc, rejected } = build({ derogatory_reference: 0.93 });

    const result = await svc.check(
      'That seller is a stupid [slur] like the rest of them.',
      'rating-comment',
      'buyer-1',
      { blockOnReview: true },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('expected a block');
    expect(result.category).toBe('derogatory_reference');
    expect(result.reason).toMatch(/respectful/i);
    expect(result.reason).toMatch(/slurs|hate speech|derogatory/i);
    expect(rejected[0]).toMatchObject({
      channel: 'rating-comment',
      category: 'derogatory_reference',
      userId: 'buyer-1',
    });
  });
});

describe('civil negative feedback is allowed', () => {
  it('passes a blunt review when Jev scores abuse and derogatory low', async () => {
    const { svc, rejected } = build({
      abuse: 0.12,
      derogatory_reference: 0.08,
    });

    const result = await svc.check(
      'The seller was dishonest about the condition and stopped replying. Avoid.',
      'rating-comment',
      'buyer-1',
      { blockOnReview: true },
    );

    expect(result.allowed).toBe(true);
    expect(rejected).toHaveLength(0);
  });
});

describe('the review band: blocked on reviews, passed on messages', () => {
  it('passes a 60–80 % verdict on an ordinary message surface', async () => {
    const { svc, rejected } = build({ abuse: 0.7 });

    const result = await svc.check(
      'You are being unfair about this.',
      'listing-inquiry',
      'buyer-1',
    );

    expect(result.allowed).toBe(true);
    // Parked for a human instead, as before.
    expect(rejected[0].category).toBe('review:abuse');
  });

  it('blocks the same verdict on the review path with a rephrase reason', async () => {
    const { svc, rejected } = build({ abuse: 0.7 });

    const result = await svc.check(
      'You are being unfair about this.',
      'rating-response',
      'seller-1',
      { blockOnReview: true },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('expected a block');
    expect(result.category).toBe('abuse');
    expect(result.reason).toMatch(/respectful/i);
    expect(result.reason).toContain('Please rephrase it.');
    expect(rejected[0].category).toBe('abuse');
  });
});
