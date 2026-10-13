import { Injectable } from '@nestjs/common';
import { CompDiff, RawComp } from './schemas';

export type MatchTier = 'EXACT_MODEL' | 'SAME_MODEL_DIFF_SPEC' | 'SAME_BRAND_CLASS';

export interface MatchDimension {
  key: string;
  label: string;
  kind: 'categorical' | 'numeric' | 'boolean';
  critical?: boolean;
  unit?: string;
  tolerancePct?: number;
  scaleWith?: boolean;
  elasticity?: number;
}

export interface MatchWeights {
  EXACT_MODEL: number;
  SAME_MODEL_DIFF_SPEC: number;
  SAME_BRAND_CLASS: number;
}

export interface DepreciationTier {
  brands: string[];
  pctByConditionAndAge: Record<string, number>;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface KeptComp {
  kind: RawComp['kind'];
  sourceSite: string;
  url: string;
  model: string | null;
  condition: string | null;
  priceCents: number;
  listedDate: Date | null;
  pageOpened: boolean;
  /** True when the cited page could not be fetched (price taken from search). */
  unverified: boolean;
  matchTier: MatchTier;
  diffs: CompDiff[];
}

export interface ExcludedComp {
  url: string;
  reason: string;
}

export interface FilterResult {
  kept: KeptComp[];
  excluded: ExcludedComp[];
}

export interface PricingInput {
  matchDimensions: MatchDimension[];
  weights: MatchWeights;
  confidenceCap: { DIFF_SPEC: ConfidenceLevel; BRAND_CLASS: ConfidenceLevel };
  minComps: number;
  anchorCents: number | null;
  depreciation: { brandTiers: Record<string, DepreciationTier>; compOverride?: string } | null;
  brand: string | null;
  conditionBand: string;
  ageBand: string;
}

export interface PricingResult {
  low: number | null;
  mid: number | null;
  high: number | null;
  asking: number | null;
  expectedSale: number | null;
  retailAnchor: number | null;
  compCount: number;
  basis: 'COMPS' | 'BLEND' | 'DEPRECIATED_ANCHOR' | 'NONE';
  tiersUsed: MatchTier[];
  formulaCents: number | null;
}

// Hostname fragments of well-known NON-South-African sources. Matched against
// the URL, so a `.co.za` dealer is never caught by a bare `.com` rule.
const INTERNATIONAL_DOMAINS = [
  'ebay.',
  'amazon.',
  'gunbroker.',
  'brownells.com',
  'midwayusa.',
  'opticsplanet.',
  'cabelas.',
  'basspro.',
  'reddit.',
  'youtube.',
];

// Sites whose comps are never persisted: research-only, in-memory for the
// median, then discarded (Facebook and Gumtree). The operator's rule.
const EPHEMERAL_HOSTS = /(facebook\.com|fb\.com|gumtree\.)/i;

export function isEphemeralUrl(url: string): boolean {
  return EPHEMERAL_HOSTS.test(url);
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  EXACT_MODEL: 1,
  SAME_MODEL_DIFF_SPEC: 0.6,
  SAME_BRAND_CLASS: 0.3,
};

/**
 * Pure comp filtering, match tiering and pricing. No I/O. Every rule that
 * matters is here, because the model follows prose loosely and these must not.
 * Category-neutral: the match dimensions come from the category config.
 */
@Injectable()
export class CompService {
  filterComps(
    comps: RawComp[],
    ctx: { selfUrls: Set<string>; minYear: number; matchDimensions?: MatchDimension[] },
  ): FilterResult {
    const dims = ctx.matchDimensions ?? [];
    const kept: KeptComp[] = [];
    const excluded: ExcludedComp[] = [];

    for (const c of comps) {
      const url = (c.url ?? '').trim();
      if (!url) {
        excluded.push({ url, reason: 'NO_URL' });
        continue;
      }
      // ⚠️ AN UNREACHABLE COMP IS KEPT, NOT DROPPED. SA classified sites
      // (bidorbuy, gumtree, facebook) block server fetches, so requiring a
      // fetched page discarded nearly every real comp and produced no price.
      // We keep it, mark it unverified, and lower confidence instead.
      if (!isZarUrl(url)) {
        excluded.push({ url, reason: 'INTERNATIONAL' });
        continue;
      }
      // Reject implausible prices. The model sometimes returns R0 or R1 for a
      // category page; a floor keeps junk out of the median and the anchor.
      const minZar = Number(process.env.VALUATION_MIN_COMP_CENTS ?? 2000) / 100;
      if (!Number.isFinite(c.priceZar) || c.priceZar < minZar) {
        excluded.push({ url, reason: 'NO_PRICE' });
        continue;
      }
      const listed = c.listedDate ? new Date(c.listedDate) : null;
      if (c.kind === 'USED_COMP') {
        if (listed && !Number.isNaN(listed.getTime()) && listed.getUTCFullYear() < ctx.minYear) {
          excluded.push({ url, reason: 'TOO_OLD' });
          continue;
        }
      }
      if (ctx.selfUrls.has(url)) {
        excluded.push({ url, reason: 'SELF_LISTING' });
        continue;
      }
      kept.push({
        kind: c.kind,
        sourceSite: c.sourceSite,
        url,
        model: c.model ?? null,
        condition: c.condition ?? null,
        priceCents: Math.round(c.priceZar * 100),
        listedDate: listed && !Number.isNaN(listed.getTime()) ? listed : null,
        pageOpened: Boolean(c.pageOpened),
        unverified: !c.pageOpened,
        matchTier: deriveTier(c.match?.diffs, dims),
        diffs: c.match?.diffs ?? [],
      });
    }

    return { kept: this.trimOutliers(kept, excluded), excluded };
  }

  /** Drop prices beyond 3x MAD from the median, only when 5+ remain. */
  private trimOutliers(kept: KeptComp[], excluded: ExcludedComp[]): KeptComp[] {
    const used = kept.filter((c) => c.kind === 'USED_COMP');
    if (used.length < 5) return kept;

    const prices = used.map((c) => c.priceCents).sort((a, b) => a - b);
    const median = medianOf(prices);
    const deviations = prices.map((p) => Math.abs(p - median)).sort((a, b) => a - b);
    const mad = medianOf(deviations);
    if (mad === 0) return kept;

    return kept.filter((c) => {
      if (c.kind !== 'USED_COMP') return true;
      const within = Math.abs(c.priceCents - median) <= 3 * mad * 1.4826;
      if (!within) excluded.push({ url: c.url, reason: 'OUTLIER' });
      return within;
    });
  }

  /**
   * The pricing decision, generic across categories. Tiers the comps, widens
   * to looser tiers only when the exact tier is thin, blends in the
   * depreciated retail anchor when comps are short, and reports the basis.
   */
  resolvePricing(kept: KeptComp[], input: PricingInput): PricingResult {
    // Anchor = the MEDIAN of all retail anchors, not the first one. A single
    // wrong-variant retail page (e.g. the 43X Rail when the item is a plain
    // 43X) could otherwise set the whole valuation off.
    const anchorPrices = kept
      .filter((c) => c.kind === 'RETAIL_ANCHOR')
      .map((c) => c.priceCents)
      .sort((a, b) => a - b);
    const anchor =
      input.anchorCents ??
      (anchorPrices.length ? medianOf(anchorPrices) : null);
    // The NEW-price anchor always contributes (a generic depreciation factor
    // when the category has no curve), so secondhand comps, the new price and
    // the similar-item indicators are ALL part of the calculation.
    const formulaCents = anchor
      ? applyDepreciation(anchor, input.depreciation, input.brand, input.conditionBand, input.ageBand)
      : null;

    // Recency-weighted: a fresher comp counts more toward the median, on top
    // of its tier weight. Comps with no date get a mild penalty.
    const now = Date.now();
    const exact = usedComps(kept, 'EXACT_MODEL');
    const diff = usedComps(kept, 'SAME_MODEL_DIFF_SPEC');
    const brandC = usedComps(kept, 'SAME_BRAND_CLASS');
    const ownWeight = Number(process.env.VALUATION_OWN_WEIGHT ?? 2);
    const poolOf = (comps: KeptComp[], tier: MatchTier) =>
      comps.map((c) => ({
        price: c.priceCents,
        weight:
          input.weights[tier] *
          recencyFactor(c.listedDate, now) *
          // A real sold price (our own or a dealer's) is worth more than an
          // asking price, even at the same tier.
          (c.sourceSite === 'own-sold' ? ownWeight : 1),
      }));

    const tiersUsed: MatchTier[] = [];
    let pool: Array<{ price: number; weight: number }> = [];

    if (exact.length >= input.minComps) {
      pool = poolOf(exact, 'EXACT_MODEL');
      tiersUsed.push('EXACT_MODEL');
    } else {
      pool = poolOf(exact, 'EXACT_MODEL');
      if (exact.length) tiersUsed.push('EXACT_MODEL');
      if (exact.length < input.minComps) {
        pool.push(...poolOf(diff, 'SAME_MODEL_DIFF_SPEC'));
        if (diff.length) tiersUsed.push('SAME_MODEL_DIFF_SPEC');
      }
      if (exact.length + diff.length < input.minComps) {
        pool.push(...poolOf(brandC, 'SAME_BRAND_CLASS'));
        if (brandC.length) tiersUsed.push('SAME_BRAND_CLASS');
      }
    }

    const usedCount = pool.length;
    const compMid = usedCount ? weightedMedian(pool) : null;
    const compLow = usedCount ? Math.min(...pool.map((p) => p.price)) : null;
    const compHigh = usedCount ? Math.max(...pool.map((p) => p.price)) : null;

    let mid: number | null = null;
    let basis: PricingResult['basis'] = 'NONE';
    if (compMid != null && formulaCents != null && exact.length < input.minComps) {
      const w = Math.min(1, usedCount / input.minComps);
      mid = Math.round(compMid * w + formulaCents * (1 - w));
      basis = 'BLEND';
    } else if (compMid != null) {
      mid = compMid;
      basis = 'COMPS';
    } else if (formulaCents != null) {
      mid = formulaCents;
      basis = 'DEPRECIATED_ANCHOR';
    }

    if (mid == null) {
      return {
        low: null,
        mid: null,
        high: null,
        asking: null,
        expectedSale: null,
        retailAnchor: anchor,
        compCount: 0,
        basis: 'NONE',
        tiersUsed,
        formulaCents,
      };
    }

    // ⚠️ A COLLAPSED BAND READS AS NONSENSE. With a thin pool the weighted
    // median can land on the pool's maximum (a heavily weighted own-sold or
    // fresh comp), so compHigh == mid and high == mid. The member then saw
    // "Mid R8 558 / High R8 558" with a recommended asking ABOVE the high and
    // a "Hold out" tier BELOW it. Widen any collapsed side to the same default
    // band used when there are no comps at all (0.8 / 1.2), and never let the
    // top of the range sit below the asking price.
    let low = compLow != null ? Math.min(compLow, mid) : roundTo100(Math.round(mid * 0.8));
    let high = compHigh != null ? Math.max(compHigh, mid) : roundTo100(Math.round(mid * 1.2));
    if (high <= mid) high = roundTo100(Math.round(mid * 1.2));
    if (low >= mid) low = roundTo100(Math.round(mid * 0.8));
    const asking = roundTo100(Math.round(mid * 1.05));
    if (high < asking) high = asking;
    // Expected sale sits between the low end and the mid, never outside the
    // band: a fair buyer price is below the ask and above the floor.
    let expectedSale = roundTo100(Math.round(mid * 0.97));
    if (expectedSale < low) expectedSale = low;
    if (expectedSale > mid) expectedSale = mid;

    return {
      low,
      mid,
      high,
      asking,
      expectedSale,
      retailAnchor: anchor,
      compCount: usedCount,
      basis,
      tiersUsed,
      formulaCents,
    };
  }

  /** Backward-compatible simple pricing (exact-model only, unweighted). */
  computePricing(kept: KeptComp[]): {
    low: number | null;
    mid: number | null;
    high: number | null;
    asking: number | null;
    expectedSale: number | null;
    retailAnchor: number | null;
    compCount: number;
  } {
    const used = kept
      .filter((c) => c.kind === 'USED_COMP')
      .map((c) => c.priceCents)
      .sort((a, b) => a - b);
    const anchor = kept.find((c) => c.kind === 'RETAIL_ANCHOR');
    if (used.length === 0) {
      return {
        low: null,
        mid: null,
        high: null,
        asking: null,
        expectedSale: null,
        retailAnchor: anchor?.priceCents ?? null,
        compCount: 0,
      };
    }
    const median = medianOf(used);
    return {
      low: used[0],
      mid: median,
      high: used[used.length - 1],
      asking: roundTo100(Math.round(median * 1.05)),
      expectedSale: roundTo100(Math.round(median * 0.97)),
      retailAnchor: anchor?.priceCents ?? null,
      compCount: used.length,
    };
  }

  /** Confidence from comp count, then one-notch downgrades per reason. */
  confidence(compCount: number, minComps: number, downgrades: number): ConfidenceLevel {
    let level: ConfidenceLevel =
      compCount >= 6 ? 'HIGH' : compCount >= minComps ? 'MEDIUM' : 'LOW';
    for (let i = 0; i < downgrades && level !== 'LOW'; i++) {
      level = level === 'HIGH' ? 'MEDIUM' : 'LOW';
    }
    return level;
  }

  /** Cap confidence when looser tiers were used. Never upgrades. */
  capConfidence(
    level: ConfidenceLevel,
    tiersUsed: MatchTier[],
    cap: PricingInput['confidenceCap'],
  ): ConfidenceLevel {
    let capped = level;
    if (tiersUsed.includes('SAME_MODEL_DIFF_SPEC')) capped = lower(capped, cap.DIFF_SPEC);
    if (tiersUsed.includes('SAME_BRAND_CLASS')) capped = lower(capped, cap.BRAND_CLASS);
    return capped;
  }

  /** How many kept used comps could not be page-verified. */
  unverifiedUsed(kept: KeptComp[]): number {
    return kept.filter((c) => c.kind === 'USED_COMP' && c.unverified).length;
  }

  /**
   * Recency downgrades: the comp window spans the last 5 years, but older
   * information is worth less. Based on the MEDIAN age of the used comps, so a
   * single old outlier does not sink an otherwise fresh set. Capped at two
   * notches so age can move HIGH to LOW but never further.
   */
  recencyDowngrades(
    kept: KeptComp[],
    now: Date,
  ): { downgrades: number; medianAgeYears: number; oldestYears: number } {
    const aged = kept
      .filter((c) => c.kind === 'USED_COMP' && c.listedDate)
      .map((c) => (now.getTime() - c.listedDate!.getTime()) / (365.25 * 24 * 3600 * 1000))
      .filter((a) => a >= 0)
      .sort((a, b) => a - b);
    if (aged.length === 0) return { downgrades: 0, medianAgeYears: 0, oldestYears: 0 };

    const medianAgeYears = medianOf(aged.map((a) => Math.round(a * 100))) / 100;
    const oldestYears = aged[aged.length - 1];
    let downgrades = 0;
    if (medianAgeYears > 1) downgrades += 1;
    if (medianAgeYears > 2.5) downgrades += 1;
    return { downgrades, medianAgeYears, oldestYears };
  }

  /** The depreciation cross-check. Returns a downgrade reason or null. */
  anchorDisagreement(medianCents: number | null, formulaCents: number | null): string | null {
    if (!medianCents || !formulaCents || formulaCents <= 0) return null;
    const pct = Math.abs(medianCents - formulaCents) / formulaCents;
    if (pct > 0.25) {
      return `comp median and depreciation formula disagree by ${Math.round(pct * 100)}%`;
    }
    return null;
  }
}

// ── match tiering ─────────────────────────────────────────────────────

export function deriveTier(diffs: CompDiff[] | undefined, dims: MatchDimension[]): MatchTier {
  // No tag at all is treated as the loosest tier, never as exact.
  if (!diffs) return 'SAME_BRAND_CLASS';
  if (diffs.length === 0) return 'EXACT_MODEL';

  let critical = false;
  let anyDiff = false;
  for (const d of diffs) {
    const dim = dims.find((m) => m.key === d.dimension);
    // A year, age, condition or usage difference is not an identity
    // difference: it is handled by recency and condition, not by the tier. The
    // model routinely adds a "year" diff, which was wrongly forcing every
    // same-model comp down to a different-spec tier.
    if (!dim && /year|age|condition|rounds?|shots?|usage|wear|service|mileage|km\b/i.test(d.dimension)) {
      continue;
    }
    if (dim?.kind === 'numeric' && dim.tolerancePct != null) {
      const a = firstNumber(d.itemValue);
      const b = firstNumber(d.compValue);
      if (a != null && b != null && Math.abs(a - b) / Math.max(a, b) <= dim.tolerancePct / 100) {
        continue; // within tolerance, not a real difference
      }
    }
    anyDiff = true;
    if (dim?.critical) critical = true;
  }
  if (critical) return 'SAME_BRAND_CLASS';
  return anyDiff ? 'SAME_MODEL_DIFF_SPEC' : 'EXACT_MODEL';
}

// ── depreciation ──────────────────────────────────────────────────────

export function depreciationKey(conditionBand: string, ageBand: string): string {
  const cond = conditionBand.toUpperCase();
  const age = ageBand.toUpperCase();
  if (cond === 'NEW' || age === 'NEW' || age === 'LT1') return 'NEW_OR_LT1YR';
  if (cond === 'POOR') return 'POOR';
  if (cond === 'FAIR' || age === '7_PLUS') return 'FAIR_OR_7YR_PLUS';
  if (cond === 'EXCELLENT') return age === '3_7' ? 'GOOD_3_7YR' : 'EXCELLENT_1_3YR';
  if (cond === 'GOOD') return age === '1_3' ? 'EXCELLENT_1_3YR' : 'GOOD_3_7YR';
  return 'GOOD_3_7YR';
}

export function applyDepreciation(
  anchorCents: number | null,
  depreciation: { brandTiers: Record<string, DepreciationTier> } | null,
  brand: string | null,
  conditionBand: string,
  ageBand: string,
): number | null {
  if (!anchorCents) return null;
  // Prefer the category's brand-tier curve when it applies.
  if (depreciation && brand) {
    const needle = brand.toLowerCase();
    const tier = Object.values(depreciation.brandTiers).find((t) =>
      t.brands.some((b) => needle.includes(b.toLowerCase()) || b.toLowerCase().includes(needle)),
    );
    if (tier) {
      const pct = tier.pctByConditionAndAge[depreciationKey(conditionBand, ageBand)];
      if (pct != null) return Math.round(anchorCents * pct);
    }
  }
  // Generic fallback so the NEW-price anchor contributes for every category,
  // not only the two with a curve.
  return Math.round(anchorCents * genericDepreciationFactor(conditionBand, ageBand));
}

/** Category-agnostic new-to-used factor by condition and age. */
export function genericDepreciationFactor(conditionBand: string, ageBand: string): number {
  const cond: Record<string, number> = {
    NEW: 0.9,
    EXCELLENT: 0.8,
    GOOD: 0.65,
    FAIR: 0.5,
    POOR: 0.3,
  };
  const age: Record<string, number> = {
    LT1: 1.0,
    '1_3': 0.92,
    '3_7': 0.8,
    '7_PLUS': 0.65,
  };
  const c = cond[conditionBand.toUpperCase()] ?? 0.65;
  const a = age[ageBand.toUpperCase()] ?? 0.85;
  return Math.min(0.95, Math.max(0.2, c * a));
}

// ── helpers ───────────────────────────────────────────────────────────

function usedComps(kept: KeptComp[], tier: MatchTier): KeptComp[] {
  return kept
    .filter((c) => c.kind === 'USED_COMP' && c.matchTier === tier)
    .sort((a, b) => a.priceCents - b.priceCents);
}

function recencyFactor(listedDate: Date | null, now: number): number {
  if (!listedDate) return 0.85;
  const ageYears = (now - listedDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (ageYears <= 0) return 1;
  return Math.max(0.4, 1 - ageYears / 5);
}

function weightedMedian(pool: Array<{ price: number; weight: number }>): number {
  const sorted = [...pool].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= total / 2) return p.price;
  }
  return sorted[sorted.length - 1].price;
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2
    ? sorted[(n - 1) / 2]
    : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
}

function roundTo100(n: number): number {
  return Math.round(n / 100) * 100;
}

function firstNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function lower(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  const order: ConfidenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
}

function isZarUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const isSaDomain = lower.includes('.co.za') || lower.includes('.za/') || lower.includes('.za:');
  if (isSaDomain) return true;
  return !INTERNATIONAL_DOMAINS.some((d) => lower.includes(d));
}
