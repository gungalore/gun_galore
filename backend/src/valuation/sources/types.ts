// Shared types for the external research adapters. Adapters are pure data
// fetchers: they return ProductHit rows and never touch the prompt. The
// orchestrator maps them to the existing RawComp shape the pricing engine
// already understands.

export type SourcePlatform =
  | 'SHOPIFY'
  | 'WOO'
  | 'SITEMAP_HTML'
  | 'MAGENTO'
  | 'MARKETPLACE'
  | 'AUCTION'
  | 'OWN'
  | 'EXCLUDED';

export type SourceRole = 'ANCHOR' | 'USED' | 'SOLD';

/** One normalized price row extracted from an external source. */
export interface ProductHit {
  /** Stable id within the source (sku/handle/short hash) for dedupe. */
  refId: string;
  title: string;
  /** Rand, whole rands. */
  priceZar: number;
  domain: string;
  brand?: string | null;
  model?: string | null;
  /** Free-text product type/category hint from the source. */
  productType?: string | null;
  /** Mapped condition id (NEW | EXCELLENT | GOOD | FAIR | POOR) when stated. */
  condition?: string | null;
  available?: boolean | null;
  /** ISO date (YYYY-MM-DD) when the source states one. */
  listedDate?: string | null;
  /** True only for closed/auction SOLD prices. */
  sold?: boolean;
  /** True for new/retail stock (drives RETAIL_ANCHOR). */
  isNew?: boolean;
  attributes?: Record<string, string>;
}

export interface SourceQuery {
  categorySlug: string;
  make: string | null;
  model: string | null;
  keySpec: string | null;
  conditionBand: string;
  limit: number;
}

export interface SourceAdapter {
  readonly platform: SourcePlatform;
  /** When set, this adapter only handles these exact domains. */
  readonly domains?: string[];
  search(domain: string, query: SourceQuery): Promise<ProductHit[]>;
}

/** The confirmed spec that external comps are compared against. */
export interface ItemSpec {
  make: string | null;
  model: string | null;
  keySpec: string | null;
}
