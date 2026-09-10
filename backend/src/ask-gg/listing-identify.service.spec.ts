// The Sell page's photo helper — the only thing left of Ask GG
// (retired 2026-09-07). It is a paid vision call on an authed route, so
// what is pinned here is the money: the quota gate, the per-tier photo
// cap, the spend rollup, and that a garbage answer degrades instead of
// breaking the form.

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ListingIdentifyService,
  buildCategoryTree,
  buildIdentifySystemPrompt,
  estimateCostUsd,
  maxPhotosPerRequest,
  parseIdentifyProposal,
} from './listing-identify.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import type { LlmService } from '../common/llm/llm.service';
import { SubscriptionTier } from '@prisma/client';

const PHOTO = { base64: 'AAAA', mediaType: 'image/jpeg' as const };

function build(
  opts: {
    tier?: SubscriptionTier;
    usedPhotoIds?: number;
    freePhotoCap?: number;
    text?: string;
    configured?: boolean;
    throws?: Error;
  } = {},
) {
  const usage = {
    aggregate: jest
      .fn()
      .mockResolvedValue({ _sum: { photoIdCount: opts.usedPhotoIds ?? 0 } }),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        subscriptionTier: opts.tier ?? SubscriptionTier.FREE,
      }),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', name: 'Optics', slug: 'optics', parentId: null },
        {
          id: 'c2',
          name: 'Rifle Scopes',
          slug: 'optics--rifle-scopes',
          parentId: 'c1',
        },
      ]),
    },
    askGgUsage: usage,
  };
  const settings = {
    get: jest.fn().mockResolvedValue(opts.freePhotoCap ?? 5),
  };
  const complete = jest.fn(async () => {
    if (opts.throws) throw opts.throws;
    return {
      text: opts.text ?? '{"title":"Leupold VX-3","confidence":"high"}',
      usage: { inputTokens: 1000, outputTokens: 200 },
    };
  });
  const llm = {
    model: 'gemini-2.5-flash-lite',
    isConfigured: () => opts.configured !== false,
    complete,
  };
  const svc = new ListingIdentifyService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
    llm as unknown as LlmService,
  );
  return { svc, prisma, usage, settings, complete };
}

describe('identify-listing — quota gate', () => {
  // ⚠️ The meter counts AskGgUsage.photoIdCount, NOT AskGgMessage. With
  // the chat retired nothing writes a message row ever again, so a
  // message-counting meter would read zero forever and hand every FREE
  // member unlimited paid vision calls. This test is the reason the
  // meter moved.
  it('meters off the usage rollup the route itself writes', async () => {
    const { svc, usage } = build({ usedPhotoIds: 2 });
    await svc.identifyForListing('user_1', [PHOTO]);
    expect(usage.aggregate).toHaveBeenCalledTimes(1);
    const where = usage.aggregate.mock.calls[0][0].where as {
      userId: string;
      day: { gte: Date };
    };
    expect(where.userId).toBe('u1');
    // Whole-day bucket, ~30 days back.
    expect(where.day.gte.getUTCHours()).toBe(0);
    const days = (Date.now() - where.day.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(32);
  });

  it('a FREE member at the cap gets 403 free-photo-quota-exhausted', async () => {
    const { svc, complete } = build({ usedPhotoIds: 5, freePhotoCap: 5 });
    await expect(svc.identifyForListing('user_1', [PHOTO])).rejects.toThrow(
      ForbiddenException,
    );
    // The Sell page branches on this exact code.
    try {
      await svc.identifyForListing('user_1', [PHOTO]);
    } catch (e) {
      const body = (e as ForbiddenException).getResponse() as {
        code: string;
        cap: number;
        used: number;
      };
      expect(body.code).toBe('free-photo-quota-exhausted');
      expect(body.cap).toBe(5);
      expect(body.used).toBe(5);
    }
    // And no model call was made — the gate is BEFORE the spend.
    expect(complete).not.toHaveBeenCalled();
  });

  it('a FREE member under the cap goes through', async () => {
    const { svc, complete } = build({ usedPhotoIds: 4, freePhotoCap: 5 });
    await svc.identifyForListing('user_1', [PHOTO]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('MEMBER and PRO are not per-user capped', async () => {
    for (const tier of [SubscriptionTier.MEMBER, SubscriptionTier.PRO]) {
      const { svc, complete, usage } = build({ tier, usedPhotoIds: 9999 });
      await svc.identifyForListing('user_1', [PHOTO]);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(usage.aggregate).not.toHaveBeenCalled();
    }
  });
});

describe('identify-listing — per-request photo cap', () => {
  it('PRO gets 10, everyone else 5', () => {
    expect(maxPhotosPerRequest(SubscriptionTier.PRO)).toBe(10);
    expect(maxPhotosPerRequest(SubscriptionTier.MEMBER)).toBe(5);
    expect(maxPhotosPerRequest(SubscriptionTier.FREE)).toBe(5);
  });

  it('rejects more photos than the tier allows, before spending', async () => {
    const { svc, complete } = build({ tier: SubscriptionTier.MEMBER });
    await expect(
      svc.identifyForListing('user_1', Array(6).fill(PHOTO)),
    ).rejects.toThrow(BadRequestException);
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects an empty upload', async () => {
    const { svc } = build();
    await expect(svc.identifyForListing('user_1', [])).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('identify-listing — spend rollup', () => {
  it('records one identification and its cost', async () => {
    const { svc, usage } = build();
    await svc.identifyForListing('user_1', [PHOTO]);
    const args = usage.upsert.mock.calls[0][0] as {
      create: { photoIdCount: number; costUsdCents: number };
      update: Record<string, unknown>;
    };
    expect(args.create.photoIdCount).toBe(1);
    // 1000 in + 200 out on flash-lite ≈ $0.00018 → 0 cents, rounded.
    expect(args.create.costUsdCents).toBe(
      Math.round((estimateCostUsd('gemini-2.5-flash-lite', 1000, 200) ?? 0) * 100),
    );
    expect(args.update).toHaveProperty('photoIdCount');
  });

  it('a model failure still returns a proposal-less answer, not a 500', async () => {
    const { svc } = build({ throws: new Error('provider down') });
    const out = await svc.identifyForListing('user_1', [PHOTO]);
    expect(out.proposal).toBeNull();
    expect(out.costUsd).toBeNull();
  });

  it('an unconfigured provider is a no-op, not a crash', async () => {
    const { svc, complete } = build({ configured: false });
    const out = await svc.identifyForListing('user_1', [PHOTO]);
    expect(out.proposal).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('parseIdentifyProposal', () => {
  it('survives a markdown fence and a preamble', () => {
    const p = parseIdentifyProposal(
      'Sure! Here you go:\n```json\n{"title":"Engel MT45","confidence":"high"}\n```',
    );
    expect(p?.title).toBe('Engel MT45');
    expect(p?.confidence).toBe('high');
  });

  it('coerces an invalid condition and confidence rather than passing them on', () => {
    const p = parseIdentifyProposal(
      '{"title":"x","condition":"MINT","confidence":"certain"}',
    );
    expect(p?.condition).toBeNull();
    expect(p?.confidence).toBe('low');
  });

  it('keeps a valid condition', () => {
    expect(parseIdentifyProposal('{"condition":"LIKE_NEW"}')?.condition).toBe(
      'LIKE_NEW',
    );
  });

  it('clamps oversized fields so the form can never be flooded', () => {
    const p = parseIdentifyProposal(
      JSON.stringify({ title: 'a'.repeat(500), description: 'b'.repeat(5000) }),
    );
    expect(p?.title).toHaveLength(200);
    expect(p?.description).toHaveLength(2000);
  });

  it('returns null on unparsable output', () => {
    expect(parseIdentifyProposal('I could not read the photos.')).toBeNull();
    expect(parseIdentifyProposal('{not json at all}')).toBeNull();
  });

  it('empty strings and nulls stay absent, never the string "null"', () => {
    const p = parseIdentifyProposal('{"manufacturer":null,"model":""}');
    expect(p?.manufacturer).toBeNull();
    expect(p?.model).toBeNull();
  });
});

describe('the prompt the photos are sent with', () => {
  it('lists sub-categories indented under their parent', () => {
    const tree = buildCategoryTree([
      { id: 'c1', name: 'Optics', slug: 'optics', parentId: null },
      { id: 'c2', name: 'Rifle Scopes', slug: 'optics--rifle-scopes', parentId: 'c1' },
    ]);
    expect(tree).toBe('optics — Optics\n  optics--rifle-scopes — Rifle Scopes');
  });

  it('carries the tree and the seller\'s pre-selected category', () => {
    const s = buildIdentifySystemPrompt({
      categoryTree: 'optics — Optics',
      categoryHint: 'optics',
    });
    expect(s).toContain('optics — Optics');
    expect(s).toContain('pre-selected category "optics"');
  });

  it('falls back to a fixed slug list when no tree is available', () => {
    const s = buildIdentifySystemPrompt({});
    expect(s).toContain('"camping-outdoor"');
  });

  // House rule: never the word "escrow" in copy a member can be shown.
  it('contains no banned payment term', () => {
    expect(/escrow/i.test(buildIdentifySystemPrompt({}))).toBe(false);
  });

  it('is sent under the askgg.identify-photos purpose', async () => {
    const { svc, complete } = build();
    await svc.identifyForListing('user_1', [PHOTO], { categoryHint: 'optics' });
    const req = (complete.mock.calls as unknown as Array<
      [
        {
          purpose: string;
          system: string;
          messages: Array<{ content: Array<{ type: string }> }>;
        },
      ]
    >)[0][0];
    expect(req.purpose).toBe('askgg.identify-photos');
    expect(req.system).toContain('optics--rifle-scopes');
    // Photos ride as bytes — there is no URL to fetch or bound.
    expect(req.messages[0].content[0].type).toBe('image');
  });
});

describe('estimateCostUsd', () => {
  it('prices a known model and refuses to invent one for an unknown', () => {
    expect(estimateCostUsd('gemini-2.5-flash-lite', 1_000_000, 0)).toBe(0.1);
    expect(estimateCostUsd('some-future-model', 1_000_000, 0)).toBeNull();
  });

  it('a zero-token call has no cost', () => {
    expect(estimateCostUsd('gemini-2.5-flash-lite', 0, 0)).toBeNull();
  });
});
