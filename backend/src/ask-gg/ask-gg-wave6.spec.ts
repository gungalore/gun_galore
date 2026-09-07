// Ask GG Everywhere — Wave 6 spec: two-lane quota decision matrix,
// draft-only ticket invariant, support-restricted system tail, and the
// lane classifier's fail-safe.

jest.mock('meilisearch', () => ({
  Meilisearch: class {},
  MeilisearchApiError: class extends Error {},
}));

import { ForbiddenException, HttpException } from '@nestjs/common';
import { AskGgQuotaService } from './ask-gg-quota.service';
import { AskGgLaneService } from './ask-gg-lane.service';
import { AskGgAccountToolsService } from './ask-gg-account-tools.service';
import {
  buildSystemBlocks,
  webSourcesPassApplies,
} from './ask-gg-model.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import type { LlmService } from '../common/llm/llm.service';
import {
  LlmError,
  type LlmRequest,
  type LlmResponse,
} from '../common/llm/llm.types';

// Settings stub — every flag resolves to its coded default
// (FREE 5/30d, MEMBER 20/h, PRO 60/h, support 20/day).
const settingsStub = {
  get: jest.fn(async (flag: { default: number }) => flag.default),
} as unknown as SettingsService;

function makeQuota(adviceUsed: number, supportUsed: number) {
  const count = jest.fn(
    async ({ where }: { where: { lane?: string; NOT?: unknown } }) =>
      where.lane === 'SUPPORT' ? supportUsed : adviceUsed,
  );
  const prisma = {
    askGgMessage: {
      count,
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const svc = new AskGgQuotaService(
    prisma as unknown as PrismaService,
    settingsStub,
  );
  return { svc, count };
}

describe('W6 decideLane — the two-lane matrix (FREE: advice 5/30d, support 20/day)', () => {
  it('SUPPORT classified + support room → support lane, unrestricted', async () => {
    const { svc } = makeQuota(5, 0); // advice full, support empty
    await expect(svc.decideLane('u1', 'FREE', 'SUPPORT')).resolves.toEqual({
      lane: 'SUPPORT',
      restricted: false,
    });
  });

  it('SUPPORT classified + support cap hit + advice room → bills advice', async () => {
    const { svc } = makeQuota(0, 20);
    await expect(svc.decideLane('u1', 'FREE', 'SUPPORT')).resolves.toEqual({
      lane: 'ADVICE',
      restricted: false,
    });
  });

  it('ADVICE classified + advice room → advice lane', async () => {
    const { svc } = makeQuota(4, 0);
    await expect(svc.decideLane('u1', 'FREE', 'ADVICE')).resolves.toEqual({
      lane: 'ADVICE',
      restricted: false,
    });
  });

  it('ADVICE classified + advice exhausted + support room → support-RESTRICTED (no hard gate)', async () => {
    const { svc } = makeQuota(5, 3);
    await expect(svc.decideLane('u1', 'FREE', 'ADVICE')).resolves.toEqual({
      lane: 'SUPPORT',
      restricted: true,
    });
  });

  it('classifier failure (null) is fail-safe: advice-first, then restricted support', async () => {
    const withRoom = makeQuota(0, 0);
    await expect(withRoom.svc.decideLane('u1', 'FREE', null)).resolves.toEqual({
      lane: 'ADVICE',
      restricted: false,
    });
    const adviceFull = makeQuota(5, 0);
    await expect(
      adviceFull.svc.decideLane('u1', 'FREE', null),
    ).resolves.toEqual({ lane: 'SUPPORT', restricted: true });
  });

  it('MIXED behaves as advice-first', async () => {
    const { svc } = makeQuota(0, 0);
    await expect(svc.decideLane('u1', 'FREE', 'MIXED')).resolves.toEqual({
      lane: 'ADVICE',
      restricted: false,
    });
  });

  it('both meters exhausted → the existing FREE 403 (frontend cards unchanged)', async () => {
    const { svc } = makeQuota(5, 20);
    await expect(svc.decideLane('u1', 'FREE', 'ADVICE')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      svc.decideLane('u1', 'FREE', 'SUPPORT'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('both exhausted on MEMBER → 429 fair-use (not 403)', async () => {
    const { svc } = makeQuota(20, 20);
    const err = await svc.decideLane('u1', 'MEMBER', 'ADVICE').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('the ADVICE meter excludes SUPPORT-lane rows (support is free)', async () => {
    const { svc, count } = makeQuota(0, 0);
    await svc.snapshot('u1', 'FREE');
    const adviceCall = count.mock.calls.find(
      (c) => (c[0] as { where: { lane?: string } }).where.lane !== 'SUPPORT',
    );
    expect(adviceCall?.[0].where.NOT).toEqual({ lane: 'SUPPORT' });
  });
});

describe('W6 draftSupportTicket — draft-only invariant', () => {
  function makeTools(txRow: { buyerId: string; sellerId: string } | null) {
    const prisma = {
      transaction: { findUnique: jest.fn().mockResolvedValue(txRow) },
      // Any write reaching prisma would be a spec failure by absence:
      supportTicket: { create: jest.fn() },
    };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const svc = new AskGgAccountToolsService(
      prisma as unknown as PrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { svc, prisma };
  }
  const ACC = { clerkId: 'c1', userId: 'u_me' };

  it('valid input → staged draft, ZERO writes', async () => {
    const { svc, prisma } = makeTools({ buyerId: 'u_me', sellerId: 'u_x' });
    const out = await svc.prepareTicketDraft(ACC, {
      subject: 'Order stuck in transit',
      category: 'shipping',
      body: 'My parcel has shown no movement since Tuesday, waybill PUD123.',
      transactionId: 'tx_mine',
    });
    expect(out.ok).toBe(true);
    expect(out.draft).toMatchObject({
      subject: 'Order stuck in transit',
      category: 'shipping',
      transactionId: 'tx_mine',
    });
    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });

  it("someone else's transactionId → refused", async () => {
    const { svc } = makeTools({ buyerId: 'u_a', sellerId: 'u_b' });
    const out = await svc.prepareTicketDraft(ACC, {
      subject: 'Problem with an order',
      body: 'Trying to attach a foreign transaction to my ticket.',
      transactionId: 'tx_foreign',
    });
    expect(out.ok).toBe(false);
    expect(out.draft).toBeUndefined();
  });

  it('bogus category falls back to general; junk reference rejected; short fields rejected', async () => {
    const { svc, prisma } = makeTools(null);
    const cat = await svc.prepareTicketDraft(ACC, {
      subject: 'Valid subject here',
      category: 'DROP TABLE',
      body: 'A perfectly reasonable body over ten characters.',
    });
    expect(cat.ok).toBe(true);
    expect(cat.draft?.category).toBe('general');

    const badRef = await svc.prepareTicketDraft(ACC, {
      subject: 'Valid subject here',
      body: 'A perfectly reasonable body over ten characters.',
      transactionId: '../etc/passwd',
    });
    expect(badRef.ok).toBe(false);
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();

    expect((await svc.prepareTicketDraft(ACC, { subject: 'x', body: 'long enough body here' })).ok).toBe(false);
    expect((await svc.prepareTicketDraft(ACC, { subject: 'long enough', body: 'short' })).ok).toBe(false);
  });
});

describe('W6 support-restricted system tail — cache safe', () => {
  it('block 1 stays byte-identical; the restricted note rides the tail', () => {
    const bare = buildSystemBlocks(false);
    const restricted = buildSystemBlocks(false, undefined, true);
    expect(restricted[0]).toEqual(bare[0]);
    const tail = restricted[restricted.length - 1] as { text: string };
    expect(tail.text).toContain('SUPPORT-RESTRICTED MODE');
    // And composes with page context without touching block 1.
    const both = buildSystemBlocks(false, '## CURRENT PAGE CONTEXT\nx', true);
    expect(both[0]).toEqual(bare[0]);
    expect((both[both.length - 1] as { text: string }).text).toContain(
      'CURRENT PAGE CONTEXT',
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// THE GROUNDED SOURCES TURN — who gets it, and what the answer turn is
// told about it.
//
// Web search came back on 2026-09-07 as a SEPARATE FINAL TURN, because
// Gemini 2.5 refuses grounding beside function declarations and every Ask
// GG answer turn carries eleven of them.
// ────────────────────────────────────────────────────────────────────
describe('the grounded sources turn — the gate', () => {
  // The paid capability. ⚠️ An ABSENT tier is FREE, matching the ballistics
  // gate: a misconfigured caller must never be handed a paid feature.
  it('is MEMBER and PRO only, and an absent tier is FREE', () => {
    expect(webSourcesPassApplies({ subscriptionTier: 'MEMBER' })).toBe(true);
    expect(webSourcesPassApplies({ subscriptionTier: 'PRO' })).toBe(true);
    expect(webSourcesPassApplies({ subscriptionTier: 'FREE' })).toBe(false);
    expect(webSourcesPassApplies({})).toBe(false);
  });

  // The advice meter is spent; a turn only allowed to answer platform
  // questions has nowhere to put a forum answer.
  it('never runs in support-restricted mode', () => {
    expect(
      webSourcesPassApplies({ subscriptionTier: 'PRO', restricted: true }),
    ).toBe(false);
  });

  // ⚠️ THE LANE FAILS TOWARD SPENDING, NOT TOWARD SILENCE. "Where's my
  // order" needs no forum — but a caller that forgets to pass the lane must
  // degrade to buying a search nobody needed, never to dropping the feature
  // a member paid for while everything still looks fine.
  it('skips the SUPPORT lane, and treats an absent lane as advice', () => {
    expect(
      webSourcesPassApplies({ subscriptionTier: 'PRO', lane: 'SUPPORT' }),
    ).toBe(false);
    expect(
      webSourcesPassApplies({ subscriptionTier: 'PRO', lane: 'ADVICE' }),
    ).toBe(true);
    expect(webSourcesPassApplies({ subscriptionTier: 'PRO' })).toBe(true);
  });
});

describe('the grounded sources turn — what the answer turn is told', () => {
  // ⚠️ THIS TAIL EXISTS TO STOP ONE CONTRADICTION: without it the model
  // writes "I can't speak for what other shooters find" directly above a
  // sourced section quoting three forums.
  it('warns the answer turn that a sourced section follows, on the tail only', () => {
    const bare = buildSystemBlocks(false);
    const withPass = buildSystemBlocks(false, undefined, false, true);
    expect(withPass[0]).toEqual(bare[0]);
    const tail = (withPass[withPass.length - 1] as { text: string }).text;
    expect(tail).toContain('A SOURCED SECTION FOLLOWS YOURS');
    expect(tail).toMatch(/do not write a sources section yourself/i);
  });

  // It grants nothing. The answer turn genuinely has no search, and the
  // standing rule against claiming what shooters report still governs it.
  it('grants no web access — the no-web-access rule stays in block 1', () => {
    const block1 = (buildSystemBlocks(false, undefined, false, true)[0] as {
      text: string;
    }).text;
    expect(block1).toContain('NEVER CLAIM WHAT SHOOTERS REPORT');
    const tail = (
      buildSystemBlocks(false, undefined, false, true).slice(-1)[0] as {
        text: string;
      }
    ).text;
    expect(tail).toContain('You still have NO web access');
  });

  it('says nothing at all when the pass will not run', () => {
    const blocks = buildSystemBlocks(false, undefined, false, false);
    expect(JSON.stringify(blocks)).not.toContain('A SOURCED SECTION FOLLOWS');
  });
});

describe('W6 lane classifier — fail-safe', () => {
  // The provider-neutral double. `configured: false` stands in for what
  // used to be "no ANTHROPIC_API_KEY" — the classifier asks LlmService,
  // never an env var.
  function fakeLlm(opts: { configured?: boolean; text?: string } = {}) {
    const complete = jest.fn(async (_req: LlmRequest): Promise<LlmResponse> => {
      const text = opts.text ?? '';
      return {
        text,
        parts: [{ type: 'text', text }],
        toolCalls: [],
        stopReason: 'end',
        usage: { inputTokens: 40, outputTokens: 1 },
        model: 'gemini-2.5-flash-lite',
        provider: 'gemini',
        assistantMessage: { role: 'assistant', content: text },
      };
    });
    return {
      provider: 'gemini' as const,
      model: 'gemini-2.5-flash-lite',
      isConfigured: () => opts.configured !== false,
      complete,
      stream: jest.fn(),
      ping: jest.fn(),
    };
  }
  const make = (llm: ReturnType<typeof fakeLlm>) =>
    new AskGgLaneService(llm as unknown as LlmService);

  it('provider not configured → null (quota service advice-first branch takes over)', async () => {
    const llm = fakeLlm({ configured: false });
    const svc = make(llm);
    await expect(svc.classify('where is my order', false)).resolves.toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('photo-bearing turns are ADVICE without any model call', async () => {
    const llm = fakeLlm({ configured: false });
    const svc = make(llm);
    await expect(svc.classify('what is this?', true)).resolves.toBe('ADVICE');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('an exact single token classifies; the call is 8 tokens with reasoning off', async () => {
    const llm = fakeLlm({ text: 'SUPPORT\n' });
    await expect(
      make(llm).classify('where is my order', false),
    ).resolves.toBe('SUPPORT');
    const req = llm.complete.mock.calls[0][0];
    expect(req.maxTokens).toBe(8);
    // ⚠️ Reasoning must be OFF: the whole answer is one token and a
    // thinking budget spends the same allowance.
    expect(req.thinking).toEqual({ budgetTokens: 0 });
    expect(req.purpose).toBe('askgg.lane');
    expect(req.tools).toBeUndefined();
  });

  it('a chatty reply that ECHOES the user fails safe to null, never to the free lane', async () => {
    const llm = fakeLlm({ text: 'The user asked SUPPORT-ish things, so: ADVICE' });
    await expect(
      make(llm).classify('should I write SUPPORT here', false),
    ).resolves.toBeNull();
  });

  it('a provider failure fails safe to null', async () => {
    const llm = fakeLlm();
    llm.complete.mockRejectedValue(new LlmError('timeout', 'too slow'));
    await expect(make(llm).classify('where is my order', false)).resolves.toBeNull();
  });
});
