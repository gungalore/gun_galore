// meilisearch ships ESM-only — Jest's CJS transform can't parse it, and it
// rides in transitively (claude service → burn-chart → search.service). The
// spec never touches search; stub the module shape.
jest.mock('meilisearch', () => ({
  Meilisearch: class MeilisearchStub {},
  MeilisearchApiError: class MeilisearchApiErrorStub extends Error {},
}));

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FeeCalculator } from '../payments/fee.calculator';
import { AskGgPlatformToolsService } from './ask-gg-platform-tools.service';
import { buildSystemBlocks } from './ask-gg-claude.service';
import {
  truncateAskGgHistory,
  HISTORY_MAX_MESSAGES,
  HISTORY_MAX_CHARS,
} from './ask-gg.service';
import type { AskGgChatMessage } from './ask-gg-claude.service';

// ─── Wave-1 gates: fee parity · banned-word scan · cache identity ·
//     history truncation ───────────────────────────────────────────────

describe('computeFees ↔ FeeCalculator parity', () => {
  const fees = new FeeCalculator();
  // Prisma + KB are unused by computeFees — safe to stub.
  const svc = new AskGgPlatformToolsService(
    {} as never,
    fees,
    {} as never,
  );

  it('sale parity — buyer-paid fee, courier + waybill', () => {
    const out = svc.computeFees(
      { kind: 'sale', priceZar: 8500, shippingZar: 120, passFeeToBuyer: true },
      false,
    ) as unknown as Record<string, number>;
    const b = fees.breakdown(850_000, true, false, 12_000, 'manual', 1_500);
    expect(out.buyerTotalRand).toBe(b.buyerTotal / 100);
    expect(out.sellerPayoutRand).toBe(b.sellerPayout / 100);
    expect(out.commissionRand).toBe(b.commissionZar / 100);
    expect(out.processingFeeRand).toBe(b.processingFee / 100);
    expect(out.shippingHandlingRand).toBe(15);
  });

  it('sale parity — top-seller discount applied from the server flag', () => {
    const plain = svc.computeFees({ kind: 'sale', priceZar: 20_000 }, false) as {
      commissionRand: number;
    };
    const top = svc.computeFees({ kind: 'sale', priceZar: 20_000 }, true) as {
      commissionRand: number;
    };
    const expectPlain = fees.calculateCommission(2_000_000, false) / 100;
    const expectTop = fees.calculateCommission(2_000_000, true) / 100;
    expect(plain.commissionRand).toBe(expectPlain);
    expect(top.commissionRand).toBe(expectTop);
    expect(top.commissionRand).toBeLessThan(plain.commissionRand);
  });

  it('experience parity', () => {
    const out = svc.computeFees(
      { kind: 'experience', priceZar: 15_000, passFeeToBuyer: true },
      false,
    ) as unknown as Record<string, number>;
    const b = fees.breakdownExperience(1_500_000, true, false, 'manual');
    expect(out.buyerTotalRand).toBe(b.buyerTotal / 100);
    expect(out.sellerPayoutRand).toBe(b.sellerPayout / 100);
  });

  it('swap leg + swap cash parity', () => {
    const leg = svc.computeFees(
      { kind: 'swapLeg', courierZar: 95, cashZar: 500 },
      false,
    ) as unknown as Record<string, number>;
    const bl = fees.breakdownSwapLeg(9_500, 50_000, false, 'manual');
    expect(leg.partyTotalRand).toBe(bl.partyTotal / 100);
    expect(leg.serviceFeeRand).toBe(50);

    const fire = svc.computeFees(
      { kind: 'swapLeg', isFirearmLeg: true },
      false,
    ) as unknown as Record<string, number>;
    expect(fire.serviceFeeRand).toBe(100);

    const cash = svc.computeFees({ kind: 'swapCash', cashZar: 3_000 }, false) as {
      commissionRand: number;
    };
    expect(cash.commissionRand).toBe(fees.swapCashCommission(300_000) / 100);
    const free = svc.computeFees({ kind: 'swapCash', cashZar: 900 }, false) as {
      commissionRand: number;
    };
    expect(free.commissionRand).toBe(0);
  });

  it('garbage inputs never throw and never go negative', () => {
    const out = svc.computeFees(
      { kind: 'sale', priceZar: -50 as number, shippingZar: NaN as number },
      false,
    ) as unknown as Record<string, number>;
    expect(out.buyerTotalRand).toBeGreaterThanOrEqual(0);
    expect(out.sellerPayoutRand).toBeGreaterThanOrEqual(0);
  });
});

describe('banned-word scan (compliance lock: "funds held", never the e-word)', () => {
  const files = [
    path.join(__dirname, 'ask-gg-claude.service.ts'),
    path.join(__dirname, 'ask-gg-platform-tools.service.ts'),
    path.join(__dirname, '..', '..', 'prisma', 'seed-data', 'help-centre.ts'),
  ];
  for (const f of files) {
    it(`${path.basename(f)} contains no banned payment term`, () => {
      const text = fs.readFileSync(f, 'utf8');
      expect(/escrow/i.test(text)).toBe(false);
    });
  }
});

describe('buildSystemBlocks cache identity (B0)', () => {
  it('block 1 is byte-identical across escalate/context variants and cached', () => {
    const base = buildSystemBlocks(false);
    const esc = buildSystemBlocks(true);
    const ctx = buildSystemBlocks(false, '## CURRENT PAGE\nuser is on /listings/x');
    const both = buildSystemBlocks(true, '## CURRENT PAGE\nuser is on /listings/x');
    for (const v of [esc, ctx, both]) {
      expect(v[0].text).toBe(base[0].text);
      expect(v[0].cache_control).toEqual({ type: 'ephemeral' });
    }
  });

  it('dynamic tail is a SECOND block and is never cache-marked', () => {
    expect(buildSystemBlocks(false)).toHaveLength(1);
    const esc = buildSystemBlocks(true);
    expect(esc).toHaveLength(2);
    expect(esc[1].text).toContain('RETRY MODE');
    expect(esc[1].cache_control).toBeUndefined();
    const both = buildSystemBlocks(true, 'CTX');
    expect(both).toHaveLength(2);
    expect(both[1].text).toContain('CTX');
    expect(both[1].text).toContain('RETRY MODE');
    expect(both[1].cache_control).toBeUndefined();
  });
});

describe('truncateAskGgHistory (B0)', () => {
  const msg = (
    role: 'user' | 'assistant',
    content: string,
  ): AskGgChatMessage => ({ role, content, imageUrls: [] });

  it('short histories pass through untouched', () => {
    const h = [msg('user', 'hi'), msg('assistant', 'hello')];
    expect(truncateAskGgHistory(h)).toBe(h);
  });

  it('caps by message count, keeps first user anchor + seam marker', () => {
    const h: AskGgChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      h.push(msg('user', `q${i}`));
      h.push(msg('assistant', `a${i}`));
    }
    const t = truncateAskGgHistory(h);
    expect(t.length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES + 1); // +anchor
    expect(t[0].content).toBe('q0'); // topic anchor retained
    expect(t.some((m) => m.content.startsWith('[Earlier part'))).toBe(true);
    // Newest turn always kept.
    expect(t[t.length - 1].content).toBe('a29');
    // Trimmed window starts on a user turn (after the anchor).
    expect(t[1].role).toBe('user');
  });

  it('caps by character volume', () => {
    const big = 'x'.repeat(9_000);
    const h = [
      msg('user', 'first question'),
      msg('assistant', big),
      msg('user', big),
      msg('assistant', big),
      msg('user', 'latest question'),
    ];
    const t = truncateAskGgHistory(h);
    const chars = t.reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThanOrEqual(HISTORY_MAX_CHARS + 200); // + seam marker
    expect(t[t.length - 1].content).toBe('latest question');
    expect(t[0].content).toBe('first question'); // anchor
  });

  it('never drops the current (newest) turn even if oversized', () => {
    const h = [msg('user', 'old'), msg('user', 'y'.repeat(40_000))];
    const t = truncateAskGgHistory(h);
    expect(t[t.length - 1].content.endsWith('y'.repeat(10))).toBe(true);
  });
});
