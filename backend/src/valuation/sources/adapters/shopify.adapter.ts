import { Injectable } from '@nestjs/common';
import { getJson } from '../http';
import { isRelevant } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

interface ShopifyVariant {
  price?: string | number;
  available?: boolean;
  sku?: string | null;
}
interface ShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  product_type?: string;
  vendor?: string;
  published_at?: string;
  variants?: ShopifyVariant[];
}

/**
 * Reads a Shopify store's public product feed (/products.json). New retail
 * prices only: every hit is an anchor. No key, no scraping, no Apify.
 */
@Injectable()
export class ShopifyAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'SHOPIFY';

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const perPage = Math.min(Math.max(query.limit, 1), 250);
    const { ok, data } = await getJson<{ products?: ShopifyProduct[] }>(
      `https://${domain}/products.json?limit=${perPage}`,
    );
    if (!ok || !Array.isArray(data?.products)) return [];

    const hits: ProductHit[] = [];
    for (const p of data.products) {
      const title = (p.title ?? '').trim();
      if (!title || !isRelevant(title, query)) continue;
      const variant = p.variants?.[0];
      const priceZar = Number(variant?.price ?? 0);
      if (!priceZar || priceZar <= 0) continue;
      hits.push({
        refId: p.handle || String(p.id ?? title),
        title,
        priceZar,
        domain,
        brand: p.vendor?.trim() || null,
        model: null,
        productType: p.product_type?.trim() || null,
        condition: 'NEW',
        available: variant?.available ?? null,
        listedDate: p.published_at ? p.published_at.slice(0, 10) : null,
        isNew: true,
      });
      if (hits.length >= query.limit) break;
    }
    return hits;
  }
}
