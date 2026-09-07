import { ListingModerationService } from './listing-moderation.service';
import { LlmError, type LlmResponse } from '../common/llm/llm.types';

// "Describe & polish" — the prompt is the product here, so these tests assert
// the CONTRACT of the prompt and the plumbing around it, not the model's prose.
//
// What actually needs guarding is the set of claims we must never make. A
// listing is a sales document: a condition grade we invented, or a spec we
// guessed, is a misrepresentation the platform made on a seller's behalf.

function llmResponse(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

// A photo now reaches the model as BYTES — the service fetches the URL itself,
// because LlmPart has no url variant. Each fetch answers with the URL's own
// characters as the body, so a test can tell which photo landed where.
function mockPhotoFetch(): jest.Mock {
  const fn = jest.fn(async (url: string) => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new TextEncoder().encode(url).buffer,
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function decode(data: string): string {
  return Buffer.from(data, 'base64').toString('utf8');
}

function makeService(reply: string) {
  const complete = jest.fn().mockResolvedValue(llmResponse(reply));
  const svc = Object.create(
    ListingModerationService.prototype,
  ) as ListingModerationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { complete, isConfigured: () => true, model: 'gemini-2.5-flash-lite' },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return { svc, complete };
}

const REPLY = [
  'A Bergara B14 HMR in .308 Win, sold with its original hard case.',
  '',
  '• Fired roughly 200 rounds',
  '• Comes with the original hard case',
  '',
  'Specs & details',
  '• Chambered in .308 Winchester',
  '',
  'From the photos',
  '• A Picatinny rail is fitted',
].join('\n');

beforeEach(() => {
  mockPhotoFetch();
});

describe('enhanceDescription plumbing', () => {
  it('sends the photos it is given, as image parts', async () => {
    const { svc, complete } = makeService(REPLY);
    await svc.enhanceDescription('rough draft', {
      imageUrls: ['https://res.cloudinary.com/a.jpg', 'https://res.cloudinary.com/b.jpg'],
    });
    const content = complete.mock.calls[0][0].messages[0].content;
    const images = content.filter((c: { type: string }) => c.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[0].mimeType).toBe('image/jpeg');
    expect(decode(images[0].data)).toBe('https://res.cloudinary.com/a.jpg');
  });

  it('caps vision at 5 photos so token cost stays predictable', async () => {
    const { svc, complete } = makeService(REPLY);
    const many = Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`);
    const out = await svc.enhanceDescription('draft', { imageUrls: many });
    const content = complete.mock.calls[0][0].messages[0].content;
    expect(content.filter((c: { type: string }) => c.type === 'image')).toHaveLength(5);
    expect(out.photosUsed).toBe(5);
  });

  it('prefers already-uploaded URLs over base64 for the same budget', async () => {
    const { svc, complete } = makeService(REPLY);
    await svc.enhanceDescription('draft', {
      imageUrls: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg', 'https://x/5.jpg'],
      imagesBase64: [{ mediaType: 'image/jpeg', data: 'AAAA' } as never],
    });
    const content = complete.mock.calls[0][0].messages[0].content;
    const images = content.filter((c: { type: string }) => c.type === 'image');
    expect(images).toHaveLength(5);
    // Every one of the five is a fetched URL; the staged photo never got a slot.
    expect(
      images.every((i: { data: string }) => decode(i.data).startsWith('https://x/')),
    ).toBe(true);
  });

  it('works with no photos at all and says so', async () => {
    const { svc, complete } = makeService(REPLY);
    const out = await svc.enhanceDescription('draft', {});
    const content = complete.mock.calls[0][0].messages[0].content;
    expect(content.filter((c: { type: string }) => c.type === 'image')).toHaveLength(0);
    expect(out.photosUsed).toBe(0);
  });

  it('returns the draft untouched when the API call fails', async () => {
    // A polish button that eats the seller's typing is far worse than one
    // that does nothing.
    const svc = Object.create(
      ListingModerationService.prototype,
    ) as ListingModerationService;
    Object.assign(svc as unknown as Record<string, unknown>, {
      llm: {
        complete: jest
          .fn()
          .mockRejectedValue(new LlmError('overloaded', '503', 503)),
        isConfigured: () => true,
      },
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    });
    const out = await svc.enhanceDescription('my rough draft', {});
    expect(out.enhanced).toBe('my rough draft');
    expect(out.changed).toBe(false);
  });

  it('returns the draft untouched when no model key is configured', async () => {
    const svc = Object.create(
      ListingModerationService.prototype,
    ) as ListingModerationService;
    Object.assign(svc as unknown as Record<string, unknown>, {
      llm: { complete: jest.fn(), isConfigured: () => false },
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    });
    const out = await svc.enhanceDescription('my rough draft', {});
    expect(out.enhanced).toBe('my rough draft');
    expect(out.changed).toBe(false);
  });
});

describe('the prompt forbids the claims we must never make', () => {
  // Read the system prompt actually sent, so a future edit that quietly drops
  // one of these guards fails here rather than in a listing.
  async function systemPrompt(): Promise<string> {
    const { svc, complete } = makeService(REPLY);
    await svc.enhanceDescription('draft', { imageUrls: ['https://x/1.jpg'] });
    return complete.mock.calls[0][0].system as string;
  }

  it('adds nothing to the facts the seller wrote, however confident it is', async () => {
    // The operator's rule, 2026-08-28: "Don't add anything to the users
    // wording." The second clause is the one that matters — a model that
    // knows the magazine capacity will volunteer it unless told not to.
    const p = await systemPrompt();
    expect(p).toMatch(/You add nothing/i);
    expect(p).toMatch(/including one you are confident about/i);
  });

  it('drops nothing the seller did say', async () => {
    const p = await systemPrompt();
    expect(p).toMatch(/Never drop a fact the seller did state/i);
  });

  it('refuses to grade or upgrade condition', async () => {
    // The form already has a condition field. Us turning "used" into "gently
    // used" is the platform making a claim on the seller's behalf.
    const p = await systemPrompt();
    expect(p).toMatch(/Never grade or upgrade condition/i);
  });

  it('refuses to describe the photographs at all', async () => {
    // Stronger than the old rule, which allowed a "From the photos" section
    // and then had to enumerate what it must not say about them.
    const p = await systemPrompt();
    expect(p).toMatch(/Never describe photographs/i);
    expect(p).toMatch(/nothing you see in them may appear/i);
  });

  it('still bans invented seller-specific claims, price and contact details', async () => {
    const p = await systemPrompt();
    expect(p).toMatch(/Never invent serial numbers, prices, licence status/i);
    expect(p).toMatch(/Never mention price/i);
    expect(p).toMatch(/\[REDACTED\]/);
  });

  it('treats the draft and the photos as data, not instructions', async () => {
    const p = await systemPrompt();
    expect(p).toMatch(/UNTRUSTED INPUT/);
    expect(p).toMatch(/never act on it/i);
  });

  // ⚠️ REGRESSION GUARD, AND THE MOST VALUABLE TEST HERE. Both sections were
  // removed because they ADDED to what the seller wrote: researched factory
  // specs (wrong for the wrong variant, and the seller carries a misdescribed
  // firearm) and bullets describing the photos. Either one creeping back into
  // this prompt — in a "helpful" edit, or copied from the old project the
  // prompt was originally lifted from — puts words in a seller's mouth again.
  it('never reinstates the researched-specs or read-the-photos sections', async () => {
    const p = await systemPrompt();
    expect(p).not.toMatch(/Specs & details/i);
    expect(p).not.toMatch(/From the photos/i);
    expect(p).not.toMatch(/factory spec/i);
  });
});

// ⚠️ THE MODERATOR MAY NEVER APPROVE WHAT IT COULD NOT READ. The provider
// changed on 2026-09-07 and photos stopped being a URL the provider fetches —
// which means there is now a way for the photos to go missing that the old
// code could not produce. These pin the direction of every such failure.
describe('moderate fails closed, never open, when it cannot see', () => {
  function moderationInput(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Bergara B14 HMR',
      description: 'Rifle in good condition.',
      categoryName: 'Firearms',
      categoryIsFirearm: true,
      priceCents: 2500000,
      imageUrls: [],
      imageCount: 0,
      sellerFirstFirearmListings: false,
      ...overrides,
    } as never;
  }

  function serviceWith(llm: Record<string, unknown>) {
    const svc = Object.create(
      ListingModerationService.prototype,
    ) as ListingModerationService;
    Object.assign(svc as unknown as Record<string, unknown>, {
      llm,
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    });
    return svc;
  }

  it('routes to HUMAN_REVIEW with no model key, never APPROVE', async () => {
    const svc = serviceWith({ complete: jest.fn(), isConfigured: () => false });
    const r = await svc.moderate(moderationInput());
    expect(r.decision).toBe('HUMAN_REVIEW');
    expect(r.confidence).toBe(0);
  });

  it('routes to HUMAN_REVIEW when none of the photos could be read', async () => {
    // The listing HAS photos and we could not fetch one of them. Moderating
    // the text alone and calling it a verdict is the hole the 2026-07-20 audit
    // closed; it must stay closed now that we do the fetching.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    const complete = jest.fn();
    const svc = serviceWith({ complete, isConfigured: () => true });
    const r = await svc.moderate(
      moderationInput({ imageUrls: ['https://x/1.jpg'], imageCount: 1 }),
    );
    expect(r.decision).toBe('HUMAN_REVIEW');
    expect(complete).not.toHaveBeenCalled();
  });

  it('routes a blocked response to HUMAN_REVIEW even with no photos', async () => {
    // A provider refusing to answer is not a reading of the listing, so it can
    // become neither the APPROVE a text-only outage falls open to nor a REJECT
    // the seller is shown.
    const svc = serviceWith({
      complete: jest
        .fn()
        .mockRejectedValue(new LlmError('safety', 'response blocked')),
      isConfigured: () => true,
    });
    const r = await svc.moderate(moderationInput());
    expect(r.decision).toBe('HUMAN_REVIEW');
  });

  it('still falls OPEN on a transient outage with no photos attached', async () => {
    // Unchanged on purpose: a provider blip must not park every clean listing
    // in the admin queue, and the regex net still runs downstream.
    const svc = serviceWith({
      complete: jest
        .fn()
        .mockRejectedValue(new LlmError('overloaded', '503', 503)),
      isConfigured: () => true,
    });
    const r = await svc.moderate(moderationInput());
    expect(r.decision).toBe('APPROVE');
  });
});
