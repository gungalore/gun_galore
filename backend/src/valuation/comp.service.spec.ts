import { CompService, KeptComp, MatchDimension, applyDepreciation, deriveTier } from './comp.service';
import { RawComp } from './schemas';

const svc = new CompService();

function comp(over: Partial<RawComp>): RawComp {
  return {
    kind: 'USED_COMP',
    sourceSite: 'gunafrica',
    url: 'https://gunafrica.com/listings/1',
    model: 'Ruger M77',
    condition: 'Good',
    priceZar: 30000,
    listedDate: '2025-06-01',
    pageOpened: true,
    ...over,
  };
}

const ctx = { selfUrls: new Set<string>(), minYear: 2025 };

describe('CompService.filterComps', () => {
  it('keeps an unverifiable comp as unverified rather than dropping it, and drops the rest with reasons', () => {
    const { kept, excluded } = svc.filterComps(
      [
        comp({ url: 'https://gunafrica.co.za/a', pageOpened: false }),
        comp({ url: 'https://www.ebay.com/itm/1' }),
        comp({ url: 'https://gunafrica.co.za/b', priceZar: 0 }),
        comp({ url: 'https://gunafrica.co.za/c', listedDate: '2023-01-01' }),
        comp({ url: 'https://gunafrica.co.za/d', priceZar: 28000 }),
      ],
      { selfUrls: new Set(['https://gunafrica.co.za/d']), minYear: 2025 },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].unverified).toBe(true);
    expect(excluded.map((e) => e.reason).sort()).toEqual(
      ['INTERNATIONAL', 'NO_PRICE', 'TOO_OLD', 'SELF_LISTING'].sort(),
    );
  });

  it('keeps a valid opened SA used comp', () => {
    const { kept } = svc.filterComps([comp({})], ctx);
    expect(kept).toHaveLength(1);
    expect(kept[0].priceCents).toBe(3_000_000);
  });
});

describe('CompService.computePricing', () => {
  it('computes an odd median, range and R100-rounded prices', () => {
    const kept = [
      { kind: 'USED_COMP' as const, sourceSite: 'x', url: 'u1', model: null, condition: null, priceCents: 2_000_000, listedDate: null, pageOpened: true, unverified: false, matchTier: 'EXACT_MODEL' as const, diffs: [] },
      { kind: 'USED_COMP' as const, sourceSite: 'x', url: 'u2', model: null, condition: null, priceCents: 3_000_000, listedDate: null, pageOpened: true, unverified: false, matchTier: 'EXACT_MODEL' as const, diffs: [] },
      { kind: 'USED_COMP' as const, sourceSite: 'x', url: 'u3', model: null, condition: null, priceCents: 4_000_000, listedDate: null, pageOpened: true, unverified: false, matchTier: 'EXACT_MODEL' as const, diffs: [] },
    ];
    const p = svc.computePricing(kept);
    expect(p.mid).toBe(3_000_000);
    expect(p.low).toBe(2_000_000);
    expect(p.high).toBe(4_000_000);
    expect(p.asking).toBe(3_150_000);
    expect(p.expectedSale).toBe(2_910_000);
    expect(p.compCount).toBe(3);
  });

  it('returns nulls when there are no used comps', () => {
    const p = svc.computePricing([]);
    expect(p.mid).toBeNull();
    expect(p.compCount).toBe(0);
  });
});

describe('CompService.confidence', () => {
  it('is HIGH at 6+ comps, MEDIUM at 3-5, LOW below minComps', () => {
    expect(svc.confidence(6, 3, 0)).toBe('HIGH');
    expect(svc.confidence(4, 3, 0)).toBe('MEDIUM');
    expect(svc.confidence(2, 3, 0)).toBe('LOW');
  });

  it('downgrades one notch per reason and never upgrades', () => {
    expect(svc.confidence(6, 3, 1)).toBe('MEDIUM');
    expect(svc.confidence(6, 3, 2)).toBe('LOW');
    expect(svc.confidence(6, 3, 5)).toBe('LOW');
  });
});

const DIMS: MatchDimension[] = [
  { key: 'calibre', label: 'Calibre', kind: 'categorical', critical: true },
  { key: 'variant', label: 'Variant', kind: 'categorical', critical: false },
  { key: 'bladeLength', label: 'Blade', kind: 'numeric', unit: 'in', tolerancePct: 15, critical: true },
];

function kept(over: Partial<KeptComp>): KeptComp {
  return {
    kind: 'USED_COMP',
    sourceSite: 'x',
    url: 'https://gunafrica.com/a',
    model: 'Ruger M77',
    condition: 'Good',
    priceCents: 3_000_000,
    listedDate: null,
    pageOpened: true,
    unverified: false,
    matchTier: 'EXACT_MODEL',
    diffs: [],
    ...over,
  };
}

const BASE_INPUT = {
  matchDimensions: DIMS,
  weights: { EXACT_MODEL: 1, SAME_MODEL_DIFF_SPEC: 0.6, SAME_BRAND_CLASS: 0.3 },
  confidenceCap: { DIFF_SPEC: 'MEDIUM' as const, BRAND_CLASS: 'LOW' as const },
  minComps: 3,
  anchorCents: null,
  depreciation: null,
  brand: 'Ruger',
  conditionBand: 'GOOD',
  ageBand: '3_7',
};

describe('CompService match tiering', () => {
  it('derives EXACT_MODEL with no diffs, and BRAND_CLASS for a critical mismatch', () => {
    expect(deriveTier([], DIMS)).toBe('EXACT_MODEL');
    expect(deriveTier([{ dimension: 'variant', compValue: 'A' }], DIMS)).toBe(
      'SAME_MODEL_DIFF_SPEC',
    );
    expect(deriveTier([{ dimension: 'calibre', compValue: '.30-06' }], DIMS)).toBe(
      'SAME_BRAND_CLASS',
    );
  });

  it('treats a numeric diff within tolerance as no difference', () => {
    expect(deriveTier([{ dimension: 'bladeLength', itemValue: '3.5in', compValue: '3.4in' }], DIMS)).toBe(
      'EXACT_MODEL',
    );
    expect(deriveTier([{ dimension: 'bladeLength', itemValue: '3.5in', compValue: '2.0in' }], DIMS)).toBe(
      'SAME_BRAND_CLASS',
    );
  });

  it('treats an untagged comp as brand-class, never exact', () => {
    expect(deriveTier(undefined, DIMS)).toBe('SAME_BRAND_CLASS');
  });

  it('caps confidence when looser tiers are used', () => {
    expect(svc.capConfidence('HIGH', ['EXACT_MODEL', 'SAME_MODEL_DIFF_SPEC'], BASE_INPUT.confidenceCap)).toBe('MEDIUM');
    expect(svc.capConfidence('HIGH', ['SAME_BRAND_CLASS'], BASE_INPUT.confidenceCap)).toBe('LOW');
    expect(svc.capConfidence('LOW', ['EXACT_MODEL'], BASE_INPUT.confidenceCap)).toBe('LOW');
  });
});

describe('CompService.resolvePricing', () => {
  it('leads with exact comps when there are enough', () => {
    const p = svc.resolvePricing(
      [kept({ priceCents: 2_000_000 }), kept({ priceCents: 3_000_000 }), kept({ priceCents: 4_000_000 })],
      BASE_INPUT,
    );
    expect(p.basis).toBe('COMPS');
    expect(p.tiersUsed).toEqual(['EXACT_MODEL']);
    expect(p.mid).toBe(3_000_000);
    expect(p.compCount).toBe(3);
  });

  it('widens to a different-spec tier when exact comps are thin', () => {
    const p = svc.resolvePricing(
      [kept({ priceCents: 3_000_000, matchTier: 'SAME_MODEL_DIFF_SPEC', diffs: [{ dimension: 'calibre', compValue: '.30-06' }] })],
      BASE_INPUT,
    );
    expect(p.tiersUsed).toContain('SAME_MODEL_DIFF_SPEC');
    expect(p.basis).toBe('COMPS');
    expect(p.mid).toBe(3_000_000);
  });

  it('falls back to a depreciated new-price anchor when there are no comps', () => {
    const p = svc.resolvePricing([], {
      ...BASE_INPUT,
      anchorCents: 2_000_000,
      depreciation: {
        brandTiers: {
          MID: { brands: ['Ruger'], pctByConditionAndAge: { GOOD_3_7YR: 0.5 } },
        },
      },
    });
    expect(p.basis).toBe('DEPRECIATED_ANCHOR');
    expect(p.formulaCents).toBe(1_000_000);
    expect(p.mid).toBe(1_000_000);
  });

  it('returns NONE when there are no comps and no anchor', () => {
    const p = svc.resolvePricing([], BASE_INPUT);
    expect(p.basis).toBe('NONE');
    expect(p.mid).toBeNull();
  });

  it('weights own-sold comps more heavily than asking comps', () => {
    const p = svc.resolvePricing(
      [
        kept({ priceCents: 1_000_000, sourceSite: 'bidorbuy.co.za' }),
        kept({ priceCents: 4_000_000, sourceSite: 'own-sold' }),
      ],
      { ...BASE_INPUT, minComps: 2 },
    );
    expect(p.mid).toBe(4_000_000);
  });

  // ⚠️ PAID FOR BY A LIVE RESULT: "Mid R8 558 / High R8 558", a recommended
  // asking ABOVE the high, and a "Hold out" tier BELOW it. A thin pool let the
  // weighted median land on the maximum, collapsing the band.
  it('widens a collapsed band on a thin pool so the range stays ordered', () => {
    const p = svc.resolvePricing([kept({ priceCents: 3_000_000 })], {
      ...BASE_INPUT,
      minComps: 1,
    });
    expect(p.mid).toBe(3_000_000);
    expect(p.high!).toBeGreaterThan(p.mid!);
    expect(p.low!).toBeLessThan(p.mid!);
    expect(p.asking!).toBeLessThanOrEqual(p.high!);
    expect(p.expectedSale!).toBeGreaterThanOrEqual(p.low!);
    expect(p.expectedSale!).toBeLessThanOrEqual(p.mid!);
  });

  it('never lets the asking price exceed the high when the median lands on the max', () => {
    const p = svc.resolvePricing(
      [
        kept({ priceCents: 1_000_000, sourceSite: 'bidorbuy.co.za' }),
        kept({ priceCents: 4_000_000, sourceSite: 'own-sold' }),
      ],
      { ...BASE_INPUT, minComps: 2 },
    );
    expect(p.mid).toBe(4_000_000);
    expect(p.low!).toBeLessThan(p.mid!);
    expect(p.high!).toBeGreaterThan(p.mid!);
    expect(p.asking!).toBeLessThanOrEqual(p.high!);
  });

  it('weights fresher comps more heavily toward the median', () => {
    const now = Date.now();
    const fiveYearsAgo = new Date(now - 5 * 365.25 * 24 * 3600 * 1000);
    const p = svc.resolvePricing(
      [
        kept({ priceCents: 1_000_000, listedDate: fiveYearsAgo }),
        kept({ priceCents: 4_000_000, listedDate: new Date(now) }),
      ],
      { ...BASE_INPUT, minComps: 2 },
    );
    // Fresh (weight 1.0) outweighs old (weight ~0.4), so the weighted median
    // lands on the fresh price, not the plain midpoint.
    expect(p.mid).toBe(4_000_000);
  });
});

describe('CompService.recencyDowngrades', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  const yearsAgo = (n: number) => new Date(now.getTime() - n * 365.25 * 24 * 3600 * 1000);

  it('does not downgrade fresh comps (median under a year)', () => {
    const r = svc.recencyDowngrades(
      [kept({ listedDate: yearsAgo(0.4) }), kept({ listedDate: yearsAgo(0.8) })],
      now,
    );
    expect(r.downgrades).toBe(0);
  });

  it('drops one notch when the median comp is over a year old', () => {
    const r = svc.recencyDowngrades([kept({ listedDate: yearsAgo(2) })], now);
    expect(r.downgrades).toBe(1);
  });

  it('drops two notches when the median comp is over 2.5 years old', () => {
    const r = svc.recencyDowngrades(
      [kept({ listedDate: yearsAgo(3) }), kept({ listedDate: yearsAgo(4) })],
      now,
    );
    expect(r.downgrades).toBe(2);
    expect(r.medianAgeYears).toBeGreaterThan(2.5);
    expect(r.oldestYears).toBeGreaterThan(3.9);
  });

  it('ignores comps without a date', () => {
    const r = svc.recencyDowngrades([kept({ listedDate: null })], now);
    expect(r.downgrades).toBe(0);
  });
});

describe('applyDepreciation', () => {
  it('matches a brand to a tier and applies the condition/age percentage', () => {
    const v = applyDepreciation(
      1_000_000,
      { brandTiers: { PREMIUM: { brands: ['Nightforce', 'Swarovski'], pctByConditionAndAge: { GOOD_3_7YR: 0.6 } } } },
      'Swarovski',
      'GOOD',
      '3_7',
    );
    expect(v).toBe(600_000);
  });

  it('falls back to a generic factor for an unknown brand, null when there is no anchor', () => {
    // GOOD (0.65) x 3_7y (0.8) = 0.52
    expect(applyDepreciation(1_000_000, { brandTiers: {} }, 'Acme', 'GOOD', '3_7')).toBe(520_000);
    expect(applyDepreciation(null, { brandTiers: {} }, 'Acme', 'GOOD', '3_7')).toBeNull();
  });
});
