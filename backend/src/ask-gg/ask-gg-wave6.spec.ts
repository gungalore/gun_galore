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
import { buildSystemBlocks } from './ask-gg-claude.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';

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

describe('W6 lane classifier — fail-safe', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  afterAll(() => {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('no API key → null (quota service advice-first branch takes over)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const svc = new AskGgLaneService();
    await expect(svc.classify('where is my order', false)).resolves.toBeNull();
  });

  it('photo-bearing turns are ADVICE without any API call', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const svc = new AskGgLaneService();
    await expect(svc.classify('what is this?', true)).resolves.toBe('ADVICE');
  });
});
