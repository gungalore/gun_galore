import { ListingModerationService } from './listing-moderation.service';
import type { ListingModerationResult } from './listing-moderation.service';
import type { LlmResponse } from '../common/llm/llm.types';

// Photo screening is a triage step, not the final judge. A vision model cannot
// tell a manufacturer's packaging URL from the seller's own shop, so the only
// image sin that stays a hard REJECT is prohibited goods (live ammunition).
// Everything else must reach the admin queue with HUMAN_REVIEW.

function llmResponse(text: string): LlmResponse {
  return {
    text,
    parts: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    assistantMessage: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function mockPhotoFetch(): void {
  global.fetch = jest.fn((url: string) =>
    Promise.resolve({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url).buffer),
    }),
  ) as unknown as typeof fetch;
}

function makeService(reply: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue(llmResponse(JSON.stringify(reply)));
  const svc = Object.create(
    ListingModerationService.prototype,
  ) as ListingModerationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { complete, isConfigured: () => true },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return { svc, complete };
}

function screen(svc: ListingModerationService) {
  return (
    svc as unknown as {
      moderateImageAxis: (input: unknown) => Promise<ListingModerationResult>;
    }
  ).moderateImageAxis({
    title: 'Distance Turret Tags',
    description: 'Turret tags.',
    categoryName: 'Shooting Accessories',
    categoryIsFirearm: false,
    priceCents: 10_000,
    imageUrls: ['https://x/1.jpg'],
    imagesBase64: [],
    imageCount: 1,
    sellerFirstFirearmListings: false,
  });
}

describe('image moderation - admin review instead of auto-reject', () => {
  beforeEach(() => {
    mockPhotoFetch();
  });

  it('sends a website URL in a photo to HUMAN_REVIEW', async () => {
    const { svc } = makeService({
      violation: true,
      unsure: false,
      categories: ['contact-info'],
      reasons: [
        'The second image contains a website URL (www.ppprsa.shop) on the product packaging.',
      ],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('HUMAN_REVIEW');
    expect(r.reasons[0]).toMatch(/website URL/i);
    expect(r.publicReason).toMatch(/admin check/i);
  });

  it('sends third-party advertising to HUMAN_REVIEW', async () => {
    const { svc } = makeService({
      violation: true,
      unsure: false,
      categories: ['advertising'],
      reasons: ['Shop signage is visible in photo 2.'],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('HUMAN_REVIEW');
  });

  it('still hard-rejects live ammunition', async () => {
    const { svc } = makeService({
      violation: true,
      unsure: false,
      categories: ['live-ammo'],
      reasons: ['Live ammunition is offered for sale in photo 2.'],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('REJECT');
  });

  it('keeps the live-ammo hard block even when categories are missing', async () => {
    const { svc } = makeService({
      violation: true,
      unsure: false,
      reasons: ['Ammunition offered for sale in photo 2.'],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('REJECT');
  });

  it('still sends an unsure verdict to HUMAN_REVIEW', async () => {
    const { svc } = makeService({
      violation: true,
      unsure: true,
      categories: ['contact-info'],
      reasons: ['Could not tell whether the label is original packaging.'],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('HUMAN_REVIEW');
  });

  it('approves a clean photo', async () => {
    const { svc } = makeService({
      violation: false,
      unsure: false,
      categories: [],
      reasons: [],
    });
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
  });
});
