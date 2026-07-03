import { PriceEstimateService } from './price-estimate.service';

// Deterministic-core tests for the resale-value estimator: the comps range,
// the active-asks fallback, the condition depreciation on the web-retail path,
// and the not-enough-data case. The web-anchor's Anthropic client is stubbed so
// no network call happens. POPIA: assert the result NEVER carries comp rows.

function makeService(overrides: {
  soldPerUnitCents?: number[];
  activeAskCents?: number[];
  webRetailZar?: number | null;
}) {
  delete process.env.ANTHROPIC_API_KEY; // construct with a null client
  const prisma = {
    transaction: {
      findMany: jest.fn().mockResolvedValue(
        (overrides.soldPerUnitCents ?? []).map((c) => ({
          listingPrice: c,
          quantity: 1,
        })),
      ),
    },
    listing: {
      findMany: jest.fn().mockResolvedValue(
        (overrides.activeAskCents ?? []).map((c) => ({ price: c })),
      ),
    },
  };
  const svc = new PriceEstimateService(prisma as never);
  if (overrides.webRetailZar !== undefined) {
    // Stub the Anthropic client so the web-anchor path is deterministic.
    (svc as unknown as { client: unknown }).client = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ retailZar: overrides.webRetailZar }),
            },
          ],
        }),
      },
    };
  }
  return { svc, prisma };
}

describe('PriceEstimateService', () => {
  it('leads with sold comps when there are enough (bucketed IQR, aggregate only)', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [
        80000, 85000, 90000, 95000, 100000, 105000, 110000, 115000,
      ],
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('sold-comps');
    expect(r.confidence).toBe('high'); // >= HIGH_CONFIDENCE_COMPS (8)
    expect(r.soldCount).toBe(8);
    expect(r.low).toBeLessThanOrEqual(r.midpoint!);
    expect(r.midpoint).toBeLessThanOrEqual(r.high!);
    // POPIA — outputs are coarse-bucketed (nearest R50) so no returned figure
    // is an exact realised price, and there are never individual comp rows.
    expect(r.low! % 5000).toBe(0);
    expect(r.midpoint! % 5000).toBe(0);
    expect(r.high! % 5000).toBe(0);
    expect(r).not.toHaveProperty('comps');
    expect(r).not.toHaveProperty('recent');
  });

  it('does NOT return sold comps below the min gate (POPIA — 3 is too few)', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [80000, 100000, 120000], // only 3
      webRetailZar: null,
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD',
    });
    // 3 comps < MIN_COMPS_FOR_PRIMARY (5) → must NOT surface those rows.
    expect(r.basis).not.toBe('sold-comps');
  });

  it('depreciates a web-anchored retail price by condition when comps are thin', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [], // no comps
      webRetailZar: 10000, // R10,000 new retail
    });
    const r = await svc.estimate({
      title: '45L camping fridge',
      categorySlug: 'camping-outdoor',
      make: 'Engel',
      condition: 'GOOD', // factor 0.58
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('web-retail');
    expect(r.confidence).toBe('low');
    // 10000 * 100 * 0.58 = 580000c midpoint, ±12% band, then bucketed to R50.
    expect(r.midpoint).toBe(580000);
    expect(r.low).toBe(Math.round(Math.round(580000 * 0.88) / 5000) * 5000);
    expect(r.high).toBe(Math.round(Math.round(580000 * 1.12) / 5000) * 5000);
    expect(r.low! % 5000).toBe(0);
  });

  it('reaches sold comps via a title proxy when no make is given (sell-form path)', async () => {
    const { svc, prisma } = makeService({
      soldPerUnitCents: [90000, 95000, 100000, 105000, 110000],
    });
    const r = await svc.estimate({
      categorySlug: 'camping-outdoor',
      title: 'Engel MT45 camping fridge', // no make field, like the sell form
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('sold-comps');
    // The comp query must have used a title CONTAINS filter (not a make match).
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.listing.title).toBeDefined();
    expect(where.listing.make).toBeUndefined();
  });

  it('falls back to discounted active asks when comps thin and no web anchor', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [],
      activeAskCents: [100000, 110000, 120000, 130000, 140000],
      webRetailZar: null, // web anchor found nothing
    });
    const r = await svc.estimate({
      categorySlug: 'fishing',
      make: 'Shimano',
      condition: 'GOOD',
    });
    expect(r.available).toBe(true);
    expect(r.basis).toBe('active-asks');
    expect(r.activeCount).toBe(5);
    // asks are nudged down by 0.9 before ranging.
    expect(r.midpoint).toBeLessThan(120000);
  });

  it('returns not-available when there is nothing to go on', async () => {
    const { svc } = makeService({ soldPerUnitCents: [], activeAskCents: [] });
    const r = await svc.estimate({
      categorySlug: 'optics',
      make: 'Vortex',
      condition: 'GOOD',
    });
    expect(r.available).toBe(false);
    expect(r.low).toBeUndefined();
    expect(r.disclaimer).toMatch(/guide only/i);
  });

  it('always carries the CPA indicative disclaimer', async () => {
    const { svc } = makeService({
      soldPerUnitCents: [50000, 60000, 70000],
    });
    const r = await svc.estimate({ categorySlug: 'knives', make: 'Cold Steel' });
    expect(r.disclaimer).toContain('not a valuation');
  });
});
