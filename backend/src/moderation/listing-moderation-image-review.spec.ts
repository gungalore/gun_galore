import { ListingModerationService } from './listing-moderation.service';
import type { ListingModerationResult } from './listing-moderation.service';
import type { ListingPhotoCategory } from './jev-image-battery';

// OPERATOR POLICY (2026-11-24): a picture is DENIED only when the moderator
// says it is denied. A failed/unavailable screen is a fail-open APPROVE; the
// 60–80% review band is not a denial either, so it approves with flags kept for
// the admin. Block-band answers are the moderator saying no, so they reject
// (unless the auto-mask turns a contact detail into a clean photo).

jest.mock('../common/llm/jev-image', () => ({
  toJevImage: jest.fn(async () => ({
    type: 'image',
    format: 'jpg',
    data_base64: 'stub',
  })),
}));

jest.mock('./photo-mask', () => ({
  maskPhotoRegions: jest.fn(async () => Buffer.from('masked-image')),
}));

const ORIGINAL_KEY = process.env.JEV_API_KEY;

beforeEach(() => {
  process.env.JEV_API_KEY = 'test-jev';
});
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = ORIGINAL_KEY;
});

/** All six photo categories, clean unless overridden. */
function photoAnswers(
  overrides: Partial<Record<ListingPhotoCategory, number>> = {},
) {
  const scores: Record<ListingPhotoCategory, number> = {
    contact: 0.05,
    qr: 0.05,
    address: 0.05,
    advertising: 0.05,
    live_ammo: 0.05,
    sexual: 0.05,
    ...overrides,
  };
  return {
    model: 'jev-1.13.0',
    provider: 'typesafe',
    usage: { inputTokens: 1, outputTokens: 0 },
    answers: Object.fromEntries(
      Object.entries(scores).map(([key, noul]) => [key, { type: 'noul', noul }]),
    ),
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

function makeService(replies: unknown[]) {
  const decide = jest.fn();
  for (const reply of replies) decide.mockResolvedValueOnce(reply);
  const complete = jest.fn();
  const svc = Object.create(
    ListingModerationService.prototype,
  ) as ListingModerationService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    llm: { decide, complete },
    logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
  });
  return { svc, decide, complete };
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

function screenMany(svc: ListingModerationService, count: number) {
  return (
    svc as unknown as {
      moderateImageAxis: (input: unknown) => Promise<ListingModerationResult>;
    }
  ).moderateImageAxis({
    title: 'Tags',
    description: 'Tags.',
    categoryName: 'Accessories',
    categoryIsFirearm: false,
    priceCents: 1,
    imageUrls: Array.from({ length: count }, (_, i) => `https://x/${i + 1}.jpg`),
    imagesBase64: [],
    imageCount: count,
    sellerFirstFirearmListings: false,
  });
}

describe('image moderation — deny only when the moderator denies', () => {
  beforeEach(() => {
    mockPhotoFetch();
  });

  it('rejects readable contact details with a photo flag and a public reason', async () => {
    const { svc, decide, complete } = makeService([
      photoAnswers({ contact: 0.92 }),
    ]);
    const r = await screen(svc);

    expect(r.decision).toBe('REJECT');
    expect(r.reasons[0]).toMatch(/contact details/i);
    expect(r.publicReason).toMatch(/contact details/i);
    expect(r.photoFlags?.[0]).toMatchObject({
      index: 1,
      categories: ['photo-contact-info'],
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][0]).toMatchObject({
      purpose: 'moderation.listing.images',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('automatically masks a boxed finding and re-screens the result', async () => {
    const { svc, decide } = makeService([
      photoAnswers({ contact: 0.92 }),
      {
        model: 'jev-1.14.0',
        provider: 'typesafe',
        usage: { inputTokens: 1, outputTokens: 0 },
        answers: {
          mask_contact_1: {
            type: 'box',
            box: { top: 0.2, bottom: 0.28, left: 0.1, right: 0.5 },
            confidence: 0.9,
          },
        },
      },
      photoAnswers(),
    ]);

    const r = await svc.screenImage('image/jpeg', 'abc');

    expect(r.decision).toBe('APPROVE');
    expect(r.maskedImage).toEqual({
      mediaType: 'image/jpeg',
      data: Buffer.from('masked-image').toString('base64'),
    });
    expect(decide.mock.calls.map((call) => call[0].purpose)).toEqual([
      'moderation.listing.images',
      'moderation.listing.image.boxes',
      'moderation.listing.images',
    ]);
  });

  it('does not approve a masked photo that still screens dirty', async () => {
    const { svc } = makeService([
      photoAnswers({ contact: 0.92 }),
      {
        model: 'jev-1.14.0',
        provider: 'typesafe',
        usage: { inputTokens: 1, outputTokens: 0 },
        answers: {
          mask_contact_1: {
            type: 'box',
            box: { top: 0.2, bottom: 0.28, left: 0.1, right: 0.5 },
            confidence: 0.9,
          },
        },
      },
      photoAnswers({ contact: 0.93 }),
    ]);

    const r = await svc.screenImage('image/jpeg', 'abc');

    expect(r.decision).toBe('REJECT');
    expect(r.maskedImage).toBeUndefined();
  });

  it('rejects a QR code, a storefront address and third-party advertising', async () => {
    for (const [category, flag] of [
      ['qr', 'qr-code'],
      ['address', 'photo-address'],
      ['advertising', 'advertising'],
    ] as const) {
      const { svc } = makeService([photoAnswers({ [category]: 0.91 })]);
      const r = await screen(svc);
      expect(r.decision).toBe('REJECT');
      expect(r.publicReason).toBeTruthy();
      expect(r.photoFlags?.[0]?.categories).toContain(flag);
    }
  });

  it('still hard-rejects live ammunition', async () => {
    const { svc } = makeService([photoAnswers({ live_ammo: 0.93 })]);
    const r = await screen(svc);
    expect(r.decision).toBe('REJECT');
    expect(r.publicReason).toMatch(/live ammunition/i);
    expect(r.photoFlags?.[0]?.categories).toContain('live-ammo');
  });

  it('⚠️ hard-rejects full nudity, and names swimwear as allowed', async () => {
    const { svc } = makeService([photoAnswers({ sexual: 0.94 })]);
    const r = await screen(svc);
    expect(r.decision).toBe('REJECT');
    expect(r.publicReason).toMatch(/nudity|sexual/i);
    expect(r.publicReason).toMatch(/swimwear/i);
  });

  it('APPROVES the 60–80 % review band (not a denial) but keeps the flag', async () => {
    const { svc } = makeService([photoAnswers({ contact: 0.7 })]);
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
    expect(r.photoFlags?.[0]?.reason).toMatch(/may show/i);
  });

  it('approves a clean photo', async () => {
    const { svc } = makeService([photoAnswers()]);
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
  });

  it('APPROVES when an answer is missing instead of reading it as clean (fail-open)', async () => {
    const { svc } = makeService([
      {
        model: 'jev-1.13.0',
        provider: 'typesafe',
        usage: { inputTokens: 1, outputTokens: 0 },
        answers: { contact: { type: 'noul', noul: 0.1 } },
      },
    ]);
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
    expect(r.reasons[0]).toMatch(/unavailable|fail-open/i);
  });

  it('APPROVES when Jev errors (a failed screen is not a denial)', async () => {
    const { svc, decide } = makeService([]);
    decide.mockRejectedValueOnce(new Error('down'));
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
    expect(r.reasons[0]).toMatch(/unavailable|fail-open/i);
  });

  it('still judges the readable photos when one photo screen fails', async () => {
    const { svc, decide } = makeService([]);
    decide
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(photoAnswers());
    const r = await screenMany(svc, 2);
    expect(r.decision).toBe('APPROVE');
  });

  it('flags the photo by its real index in a multi-photo listing', async () => {
    const { svc, decide } = makeService([
      photoAnswers(),
      photoAnswers({ contact: 0.94 }),
    ]);
    const r = await screenMany(svc, 2);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(r.photoFlags).toEqual([
      expect.objectContaining({
        index: 2,
        categories: ['photo-contact-info'],
      }),
    ]);
  });

  it('tells Jev to ignore an intentional seller redaction', async () => {
    const { svc, decide } = makeService([photoAnswers()]);
    await svc.screenImage('image/jpeg', 'abc', true);

    const args = decide.mock.calls[0][0] as {
      questions: Record<string, { instructions?: string }>;
    };
    const all = Object.values(args.questions)
      .map((q) => q.instructions ?? '')
      .join(' ');
    expect(all).toMatch(/intentionally blurred or pixelated/i);
    expect(all).toMatch(/treat that area as removed/i);
  });

  it('APPROVES when Jev is not configured (fail-open, no model call)', async () => {
    delete process.env.JEV_API_KEY;
    const { svc, decide } = makeService([]);
    const r = await screen(svc);
    expect(r.decision).toBe('APPROVE');
    expect(decide).not.toHaveBeenCalled();
  });

  it('approves with no photos and spends no model call', async () => {
    const { svc, decide } = makeService([]);
    const r = await (
      svc as unknown as {
        moderateImageAxis: (input: unknown) => Promise<ListingModerationResult>;
      }
    ).moderateImageAxis({
      title: 'Tags',
      description: 'Tags.',
      categoryName: 'Accessories',
      categoryIsFirearm: false,
      priceCents: 1,
      imageUrls: [],
      imagesBase64: [],
      imageCount: 0,
      sellerFirstFirearmListings: false,
    });
    expect(r.decision).toBe('APPROVE');
    expect(decide).not.toHaveBeenCalled();
  });
});
