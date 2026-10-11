import { Injectable } from '@nestjs/common';
import { getText } from '../http';
import { isRelevant } from '../relevance';
import { slugMatches } from '../sitemap-jsonld';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CATEGORIES = 25;
const MAX_PRODUCTS = 1200;

/** ZAR price from a Magento product page. Pure; unit-tested. */
export function parseMagentoPrice(html: string): number | null {
  const og = html.match(/product:price:amount"\s*content="([\d.]+)"/i);
  if (og) return Number(og[1]);
  const data = html.match(/data-price-amount="([\d.]+)"/i);
  if (data) return Number(data[1]);
  const itemprop = html.match(/itemprop="price"[^>]*content="([\d.]+)"/i);
  if (itemprop) return Number(itemprop[1]);
  return null;
}

export function parseTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const og = html.match(/og:title"[^>]*content="([^"]+)"/i);
  return og ? og[1].trim() : '';
}

const NON_PRODUCT = /\/(customer|checkout|wishlist|compare|catalog|brands?|blog|about|contact|help|faq|privacy|terms|account|newsletter|stores?|shipping|returns|careers|product-guides|form|gift|wishlist)\b/i;

/**
 * Magento storefronts (Futurama, Camdix and many SA firearm/outdoor dealers)
 * expose neither a product API nor JSON-LD, and often no sitemap. But their
 * category pages are clean, robots-friendly URLs that list product links, and
 * each product page carries the ZAR price in `data-price-amount` /
 * `product:price:amount`. Discovery is a shallow category crawl, cached.
 */
@Injectable()
export class MagentoAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'MAGENTO';

  private readonly caches = new Map<string, { at: number; urls: string[] }>();

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const urls = await this.productUrls(domain);
    if (urls.length === 0) return [];
    const candidates = urls
      .filter((u) => slugMatches(u, query))
      .slice(0, Math.min(Math.max(query.limit, 1) * 2, 40));
    if (candidates.length === 0) return [];

    const clean = domain.replace(/^www\./, '');
    const hits: ProductHit[] = [];
    await Promise.all(
      candidates.map(async (url) => {
        const html = await getText(url, 15_000);
        if (!html) return;
        const priceZar = parseMagentoPrice(html);
        const title = parseTitle(html);
        if (!priceZar || priceZar <= 0 || !title) return;
        if (!isRelevant(title, query)) return;
        hits.push({
          refId: url.replace(/\/$/, '').split('/').pop() ?? url,
          title,
          priceZar,
          domain: clean,
          brand: null,
          model: null,
          productType: null,
          condition: 'NEW',
          available: true,
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
    if (cached && Date.now() - cached.at < TTL_MS) return cached.urls;

    const root = `https://${domain.replace(/^www\./, '')}`;
    let home = await getText(`${root}/`, 20_000);
    if (!home) home = await getText(`https://www.${domain.replace(/^www\./, '')}/`, 20_000);
    if (!home) return [];
    const sameSite = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '') === key;
      } catch {
        return false;
      }
    };
    const categories = unique(
      [...home.matchAll(/href="(https?:\/\/[^"]+)"/gi)]
        .map((m) => m[1])
        .filter((u) => sameSite(u) && /\/$/.test(u) && !NON_PRODUCT.test(u)),
    ).slice(0, MAX_CATEGORIES);

    const products = new Set<string>();
    await Promise.all(
      categories.map(async (cat) => {
        const html = await getText(cat, 20_000);
        if (!html) return;
        for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
          const u = m[1];
          if (sameSite(u) && !/\/$/.test(u) && !u.includes('?') && !NON_PRODUCT.test(u)) {
            products.add(u);
          }
        }
      }),
    );
    const urls = [...products].slice(0, MAX_PRODUCTS);
    this.caches.set(key, { at: Date.now(), urls });
    return urls;
  }
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
