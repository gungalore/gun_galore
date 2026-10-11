import { Injectable } from '@nestjs/common';
import { getJson } from '../http';
import { distinctiveTokens, isRelevant } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

interface WooProduct {
  id?: number;
  sku?: string;
  name?: string;
  is_in_stock?: boolean;
  prices?: { price?: string; currency_minor_unit?: number };
  categories?: Array<{ name?: string }>;
}

/**
 * Reads a WooCommerce store via its public Store API
 * (/wp-json/wc/store/products). New retail prices only: every hit is an anchor.
 *
 * The Store API `search` is an AND keyword match and is form-sensitive: "MSR
 * Hubba" matches, but "MSR Hubba Hubba NX2" returns nothing because the store
 * writes "NX 2". So we try a short ladder of queries and take the first that
 * yields a relevant hit, rather than one over-specified query.
 */
@Injectable()
export class WooAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'WOO';

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const attempts = this.attempts(query);
    if (attempts.length === 0) return [];
    const perPage = Math.min(Math.max(query.limit, 1), 100);
    for (const term of attempts) {
      const url =
        `https://${domain}/wp-json/wc/store/products?per_page=${perPage}` +
        `&search=${encodeURIComponent(term)}`;
      const { ok, data } = await getJson<WooProduct[]>(url);
      if (!ok || !Array.isArray(data)) continue;
      const hits = this.toHits(data, domain, query);
      if (hits.length) return hits;
    }
    return [];
  }

  private attempts(q: SourceQuery): string[] {
    // Distinctive tokens only: searching "Blue Marlin G3 Series" verbatim pulls
    // in every blue product; "marlin g3" does not.
    const make = distinctiveTokens(q.make).join(' ');
    const model = distinctiveTokens(q.model).join(' ');
    const firstModel = distinctiveTokens(q.model)[0] ?? '';
    const all = [make && model ? `${make} ${model}` : '', make, model, firstModel];
    return [...new Set(all.filter((t) => t.length >= 2))];
  }

  private toHits(items: WooProduct[], domain: string, query: SourceQuery): ProductHit[] {
    const hits: ProductHit[] = [];
    for (const p of items) {
      const title = (p.name ?? '').trim();
      if (!title || !isRelevant(title, query)) continue;
      const minor = p.prices?.currency_minor_unit ?? 2;
      const priceZar = Number(p.prices?.price ?? 0) / Math.pow(10, minor);
      if (!priceZar || priceZar <= 0) continue;
      hits.push({
        refId: p.sku || String(p.id ?? title),
        title,
        priceZar,
        domain,
        brand: null,
        model: null,
        productType: p.categories?.[0]?.name ?? null,
        condition: 'NEW',
        available: p.is_in_stock ?? null,
        listedDate: null,
        isNew: true,
      });
      if (hits.length >= query.limit) break;
    }
    return hits;
  }
}
