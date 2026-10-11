import { Injectable } from '@nestjs/common';
import { getText } from '../http';
import { isRelevant } from '../relevance';
import { collectSitemapUrls, parseCustomData, parseProductJsonLd, slugMatches } from '../sitemap-jsonld';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

const SITEMAP_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Retailers with no product API but a public sitemap and a schema.org Product
 * JSON-LD block per product: Outdoor Warehouse (custom Vue) and Safari Outdoor
 * (Magento). Discovery is sitemap + slug match; the price comes from JSON-LD
 * (with the embedded value/currency meta as a fallback). New-price anchors only.
 */
@Injectable()
export class SitemapJsonLdAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'SITEMAP_HTML';
  readonly domains = [
    'outdoorwarehouse.co.za',
    'www.outdoorwarehouse.co.za',
    'safarioutdoor.co.za',
    'www.safarioutdoor.co.za',
  ];

  private readonly caches = new Map<string, { at: number; urls: string[] }>();

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const urls = await this.productUrls(domain);
    if (urls.length === 0) return [];

    const candidates = urls
      .filter((u) => slugMatches(u, query))
      .slice(0, Math.min(Math.max(query.limit, 1) * 2, 40));
    if (candidates.length === 0) return [];

    const hits: ProductHit[] = [];
    await Promise.all(
      candidates.map(async (url) => {
        const html = await getText(url, 15_000);
        if (!html) return;
        const ld = parseProductJsonLd(html);
        const fb = ld?.priceZar ? null : parseCustomData(html);
        const name = ld?.name ?? fb?.name ?? '';
        const priceZar = ld?.priceZar ?? fb?.priceZar ?? 0;
        if (!name || !priceZar || priceZar <= 0) return;
        if (!isRelevant(name, query)) return;
        hits.push({
          refId: url.replace(/\/$/, '').split('/').pop() ?? url,
          title: name,
          priceZar,
          domain: domain.replace(/^www\./, ''),
          brand: ld?.brand ?? null,
          model: null,
          productType: null,
          condition: 'NEW',
          available: ld?.available ? /instock/i.test(ld.available) : null,
          listedDate: null,
          isNew: true,
        });
      }),
    );
    return hits.slice(0, query.limit);
  }

  private async productUrls(domain: string): Promise<string[]> {
    const key = domain.replace(/^www\./, '');
    const cached = this.caches.get(key);
    if (cached && Date.now() - cached.at < SITEMAP_TTL_MS) return cached.urls;
    const urls = await collectSitemapUrls(domain);
    this.caches.set(key, { at: Date.now(), urls });
    return urls;
  }
}
