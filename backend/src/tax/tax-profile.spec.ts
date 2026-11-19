import {
  DEFAULT_MICRO_BUSINESS_TURNOVER_LIMIT_CENTS,
  VAT_REGISTRATION_THRESHOLD_CENTS,
  rollingWindowStart,
  summariseTurnover,
  thresholdHeadroomCents,
  thresholdPercent,
  type TaxTurnoverRow,
} from './tax-profile';

const row = (overrides: Partial<TaxTurnoverRow> = {}): TaxTurnoverRow => ({
  paidAt: new Date('2026-06-01T10:00:00Z'),
  supplyRole: 'AGENT',
  grossSalesCents: 1_000_000,
  agentRevenueCents: 100_000,
  principalRevenueCents: 0,
  refundedCents: 0,
  ...overrides,
});

describe('the tax profile', () => {
  it('⚠️ USES THE R2.3m VAT THRESHOLD, NOT R1m', () => {
    expect(VAT_REGISTRATION_THRESHOLD_CENTS).toBe(230_000_000);
    expect(VAT_REGISTRATION_THRESHOLD_CENTS).toBe(2_300_000 * 100);
    expect(DEFAULT_MICRO_BUSINESS_TURNOVER_LIMIT_CENTS).toBe(100_000_000);
  });

  it('⚠️ MEASURES AGENT REVENUE BY DEFAULT, NOT GROSS ITEM SALES', () => {
    const summary = summariseTurnover([row()], 'AGENT_REVENUE');
    expect(summary.grossSalesCents).toBe(1_000_000);
    expect(summary.agentRevenueCents).toBe(100_000);
    expect(summary.basisCents).toBe(100_000);
  });

  it('nets a refund proportionally across gross and agent revenue', () => {
    const summary = summariseTurnover([
      row({ refundedCents: 500_000 }),
    ]);
    expect(summary.grossSalesCents).toBe(500_000);
    expect(summary.agentRevenueCents).toBe(50_000);
  });

  it('reports headroom and percentage against the threshold', () => {
    expect(thresholdPercent(230_000_000, 230_000_000)).toBe(100);
    expect(thresholdHeadroomCents(200_000_000, 230_000_000)).toBe(30_000_000);
    expect(thresholdHeadroomCents(240_000_000, 230_000_000)).toBe(0);
  });

  it('uses a twelve-month rolling window', () => {
    expect(rollingWindowStart(new Date('2026-11-19T00:00:00Z')).toISOString()).toBe(
      '2025-11-19T00:00:00.000Z',
    );
  });
});
