// EXP-E3 — pure CPA-s17 cancellation calculator. No I/O, no Nest, no Prisma.
// Covers: every day-band boundary (61/60/30/29/21/20/14/13/7/6), each exempt
// reason, the R250 fixed-admin-fee floor when buyerTotal < R250, rounding, and
// — on EVERY case — the money-conservation invariant:
//   refundCents + outfitterReleaseCents + ggRetainedCents === buyerTotal
//   and every slice >= 0.
import {
  computeCpaCancellation,
  daysBefore,
  isExemptReason,
  CPA_ADMIN_FEE_CENTS,
  DEFAULT_CANCELLATION_TIERS,
  type CancellationExemptReason,
} from './cancellation-policy';
import { FeeCalculator } from './fee.calculator';

const DAY = 24 * 60 * 60 * 1000;
const fc = new FeeCalculator();
const commission = (retained: number, top: boolean) =>
  fc.calculateCommission(retained, top);

// eventDate that is exactly `d` whole days out from `now` — plus a small
// cushion so daysBefore floors to `d`, not d-1.
function eventAt(now: Date, d: number): Date {
  return new Date(now.getTime() + d * DAY + 60 * 1000);
}

function run(opts: {
  buyerTotal: number;
  days?: number;
  isTopSeller?: boolean;
  initiator?: 'BUYER' | 'OUTFITTER';
  exemptReason?: CancellationExemptReason;
}) {
  const now = new Date('2026-01-01T09:00:00.000Z');
  return computeCpaCancellation({
    buyerTotalCents: opts.buyerTotal,
    isTopSeller: opts.isTopSeller ?? false,
    eventDate: eventAt(now, opts.days ?? 40),
    now,
    initiator: opts.initiator ?? 'BUYER',
    exemptReason: opts.exemptReason,
    calculateCommission: commission,
  });
}

// The single invariant asserted on EVERY computed result.
function assertConserves(
  r: { refundCents: number; outfitterReleaseCents: number; ggRetainedCents: number; retainedCents: number },
  buyerTotal: number,
) {
  expect(r.refundCents).toBeGreaterThanOrEqual(0);
  expect(r.outfitterReleaseCents).toBeGreaterThanOrEqual(0);
  expect(r.ggRetainedCents).toBeGreaterThanOrEqual(0);
  expect(r.refundCents + r.outfitterReleaseCents + r.ggRetainedCents).toBe(
    buyerTotal,
  );
  // retainedCents == buyerTotal - refund == outfitterRelease + ggRetained.
  expect(r.retainedCents).toBe(buyerTotal - r.refundCents);
  expect(r.outfitterReleaseCents + r.ggRetainedCents).toBe(r.retainedCents);
}

describe('daysBefore', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  it('floors partial days', () => {
    expect(daysBefore(now, new Date(now.getTime() + 6.9 * DAY))).toBe(6);
    expect(daysBefore(now, new Date(now.getTime() + 7 * DAY))).toBe(7);
    expect(daysBefore(now, new Date(now.getTime() + 7.01 * DAY))).toBe(7);
  });
  it('clamps a past/at event to 0', () => {
    expect(daysBefore(now, new Date(now.getTime() - DAY))).toBe(0);
    expect(daysBefore(now, now)).toBe(0);
  });
});

describe('isExemptReason', () => {
  it('accepts the three valid reasons only', () => {
    expect(isExemptReason('DEATH')).toBe(true);
    expect(isExemptReason('HOSPITALISATION')).toBe(true);
    expect(isExemptReason('SUPPLIER_FAILURE')).toBe(true);
    expect(isExemptReason('WEATHER')).toBe(false);
    expect(isExemptReason('')).toBe(false);
    expect(isExemptReason(undefined)).toBe(false);
  });
});

describe('computeCpaCancellation — day-band boundaries (buyer, R25,000)', () => {
  const T = 2_500_000; // R25,000

  // Each boundary: [days, expected retained cents or 'adminFee', label-fragment]
  const cases: Array<{ days: number; note: string }> = [
    { days: 61, note: '>=60d fixed admin fee' },
    { days: 60, note: '>=60d fixed admin fee' },
    { days: 59, note: '30-59d 20%' },
    { days: 30, note: '30-59d 20%' },
    { days: 29, note: '21-29d 40%' },
    { days: 21, note: '21-29d 40%' },
    { days: 20, note: '14-20d 50%' },
    { days: 14, note: '14-20d 50%' },
    { days: 13, note: '7-13d 75%' },
    { days: 7, note: '7-13d 75%' },
    { days: 6, note: '<7d 100%' },
    { days: 0, note: 'no-show 100%' },
  ];

  it.each(cases)('$days days out ($note) conserves', ({ days }) => {
    const r = run({ buyerTotal: T, days });
    assertConserves(r, T);
  });

  it('>=60d (61 and 60) retains exactly R250 admin fee, GG keeps it all', () => {
    for (const days of [61, 60]) {
      const r = run({ buyerTotal: T, days });
      expect(r.retainedCents).toBe(CPA_ADMIN_FEE_CENTS); // R250
      expect(r.adminFeeCents).toBe(CPA_ADMIN_FEE_CENTS);
      expect(r.outfitterReleaseCents).toBe(0); // outfitter gets nothing on the admin fee
      expect(r.ggRetainedCents).toBe(CPA_ADMIN_FEE_CENTS); // GG keeps the whole fee
      expect(r.refundCents).toBe(T - CPA_ADMIN_FEE_CENTS);
      assertConserves(r, T);
    }
  });

  it('59d / 30d = 20% forfeit; outfitter gets retained minus GG commission', () => {
    for (const days of [59, 30]) {
      const r = run({ buyerTotal: T, days });
      const retained = Math.round(T * 0.2); // 500,000
      expect(r.retainedCents).toBe(retained);
      expect(r.refundCents).toBe(T - retained);
      expect(r.ggRetainedCents).toBe(commission(retained, false));
      expect(r.outfitterReleaseCents).toBe(retained - commission(retained, false));
      expect(r.adminFeeCents).toBe(0);
      assertConserves(r, T);
    }
  });

  it('29d / 21d = 40% forfeit', () => {
    for (const days of [29, 21]) {
      const r = run({ buyerTotal: T, days });
      const retained = Math.round(T * 0.4);
      expect(r.retainedCents).toBe(retained);
      expect(r.ggRetainedCents).toBe(commission(retained, false));
      assertConserves(r, T);
    }
  });

  it('20d / 14d = 50% forfeit', () => {
    for (const days of [20, 14]) {
      const r = run({ buyerTotal: T, days });
      expect(r.retainedCents).toBe(Math.round(T * 0.5));
      assertConserves(r, T);
    }
  });

  it('13d / 7d = 75% forfeit', () => {
    for (const days of [13, 7]) {
      const r = run({ buyerTotal: T, days });
      expect(r.retainedCents).toBe(Math.round(T * 0.75));
      assertConserves(r, T);
    }
  });

  it('6d / 0d = 100% forfeit — no refund, full retained slice split', () => {
    for (const days of [6, 0]) {
      const r = run({ buyerTotal: T, days });
      expect(r.refundCents).toBe(0);
      expect(r.retainedCents).toBe(T);
      // Outfitter gets the whole value minus GG's band commission on it.
      expect(r.ggRetainedCents).toBe(commission(T, false));
      expect(r.outfitterReleaseCents).toBe(T - commission(T, false));
      assertConserves(r, T);
    }
  });
});

describe('computeCpaCancellation — exempt reasons force a zero-charge full refund', () => {
  const T = 2_500_000;
  const reasons: CancellationExemptReason[] = [
    'DEATH',
    'HOSPITALISATION',
    'SUPPLIER_FAILURE',
  ];
  it.each(reasons)('%s → full refund, nothing retained (even <7d out)', (reason) => {
    const r = run({ buyerTotal: T, days: 2, exemptReason: reason }); // 2 days out
    expect(r.refundCents).toBe(T);
    expect(r.retainedCents).toBe(0);
    expect(r.outfitterReleaseCents).toBe(0);
    expect(r.ggRetainedCents).toBe(0);
    assertConserves(r, T);
  });

  it('OUTFITTER initiator is always a full refund (supplier failure), no reason needed', () => {
    const r = run({ buyerTotal: T, days: 3, initiator: 'OUTFITTER' }); // 3 days out
    expect(r.refundCents).toBe(T);
    expect(r.retainedCents).toBe(0);
    assertConserves(r, T);
  });
});

describe('computeCpaCancellation — R250 admin-fee floor when buyerTotal < R250', () => {
  it('caps the >=60d admin fee at buyerTotal (never retain more than paid)', () => {
    const T = 15_000; // R150 < R250
    const r = run({ buyerTotal: T, days: 90 });
    expect(r.retainedCents).toBe(T); // capped at the whole (small) buyerTotal
    expect(r.adminFeeCents).toBe(T);
    expect(r.refundCents).toBe(0); // nothing left to refund
    expect(r.outfitterReleaseCents).toBe(0); // admin fee is 100% GG
    expect(r.ggRetainedCents).toBe(T);
    assertConserves(r, T);
  });

  it('exactly R250 buyerTotal → whole thing is the admin fee, R0 refund', () => {
    const T = CPA_ADMIN_FEE_CENTS; // R250
    const r = run({ buyerTotal: T, days: 90 });
    expect(r.retainedCents).toBe(T);
    expect(r.refundCents).toBe(0);
    assertConserves(r, T);
  });
});

describe('computeCpaCancellation — rounding + odd amounts still conserve', () => {
  // Odd cents that don't divide the percentages cleanly — the invariant must
  // still hold because refund = buyerTotal - round(buyerTotal * pct).
  const odd = [1, 99, 333, 1_234_567, 7_777_777, 100_000_001];
  const bands = [59, 25, 15, 10]; // 20/40/50/75% tiers
  for (const T of odd) {
    for (const days of bands) {
      it(`buyerTotal ${T}c @ ${days}d conserves exactly`, () => {
        const r = run({ buyerTotal: T, days });
        assertConserves(r, T);
      });
    }
  }

  it('Top Seller commission discount still conserves (ggRetained tracks the discounted band)', () => {
    const T = 2_500_000;
    const r = run({ buyerTotal: T, days: 20, isTopSeller: true }); // 50% tier
    const retained = Math.round(T * 0.5);
    expect(r.ggRetainedCents).toBe(commission(retained, true));
    expect(r.outfitterReleaseCents).toBe(retained - commission(retained, true));
    assertConserves(r, T);
  });
});

describe('computeCpaCancellation — Setting override tiers', () => {
  it('honours a custom tier schedule + admin fee', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const r = computeCpaCancellation({
      buyerTotalCents: 1_000_000,
      isTopSeller: false,
      eventDate: eventAt(now, 45),
      now,
      initiator: 'BUYER',
      calculateCommission: commission,
      // Two-tier override: 40+d = R500 admin fee (top tier), else 30% forfeit.
      tiers: [
        { minDaysBefore: 40, forfeitPct: 0, label: '40+ days — R500 admin fee' },
        { minDaysBefore: 0, forfeitPct: 0.3, label: 'Under 40 days — 30%' },
      ],
      adminFeeCents: 50_000, // R500
    });
    expect(r.retainedCents).toBe(50_000);
    expect(r.adminFeeCents).toBe(50_000);
    expect(r.ggRetainedCents).toBe(50_000);
    expect(r.outfitterReleaseCents).toBe(0);
    assertConserves(r, 1_000_000);
  });
});

describe('DEFAULT_CANCELLATION_TIERS sanity', () => {
  it('is ordered and covers 0', () => {
    const mins = DEFAULT_CANCELLATION_TIERS.map((t) => t.minDaysBefore);
    expect(mins).toContain(0);
    expect(Math.max(...mins)).toBe(60);
  });
});
