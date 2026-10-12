import { Injectable } from '@nestjs/common';
import { getText } from '../http';
import { isRelevant } from '../relevance';
import { collectSitemapUrls, parseCustomData, parseProductJsonLd, slugMatches } from '../sitemap-jsonld';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';
import { parseMagentoPrice, parseTitle } from './magento.adapter';

const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CATEGORIES = 25;
const MAX_PRODUCTS = 1200;

const NON_PRODUCT =
  /\/(customer|checkout|cart|wishlist|compare|catalog|brands?|blog|news|about|contact|help|faq|privacy|policy|terms|account|login|register|newsletter|stores?|shipping|delivery|returns|careers|product-guides|gallery|form|gift|search)\b/i;

/** ZAR price from a product page, trying every common structured shape. Pure. */
export function parseHtmlPrice(html: string): number | null {
  const ld = parseProductJsonLd(html)?.priceZar;
  if (ld && ld > 0) return ld;
  const custom = parseCustomData(html)?.priceZar;
  if (custom && custom > 0) return custom;
  const magento = parseMagentoPrice(html);
  if (magento && magento > 0) return magento;
  const og = html.match(/(?:og|product):price:amount"\s*content="([\d.]+)"/i);
  if (og) return Number(og[1]);
  return null;
}

/** Product title from JSON-LD, then <h1>/og:title. Pure. */
export function parseHtmlName(html: string): string {
  const ld = parseProductJsonLd(html)?.name;
  return (ld ?? parseTitle(html) ?? '').trim();
}

function isProductUrl(url: string, host: string): boolean {
  try {
    const x = new URL(url);
    if (x.hostname.replace(/^www\./, '') !== host) return false;
    if (url.includes('?')) return false;
    const path = x.pathname;
    if (path.endsWith('/')) return false;
    if (path.split('/').filter(Boolean).length === 0) return false;
    if (NON_PRODUCT.test(path)) return false;
    if (/\.(xml|json|jpg|jpeg|png|gif|webp|css|js|pdf|ico|svg)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Generic retailer reader for shops that expose NEITHER a product API nor a
 * schema sitemap+JSON-LD feed: discovery is a sitemap when one exists, else a
 * shallow homepage -> category crawl; each product page's price is read from
 * JSON-LD, an embedded value/currency meta, a Magento-style attribute or an
 * og/product:price meta. New-price anchors only; cached for 12h.
 */
@Injectable()
export class HtmlCatalogAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'HTML';

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
        const priceZar = parseHtmlPrice(html);
        const title = parseHtmlName(html);
        if (!priceZar || priceZar <= 0 || !title) return;
        if (!isRelevant(title, query)) return;
        hits.push({
          refId: url.replace(/\/$/, '').split('/').pop() ?? url,
          title,
          priceZar,
          domain: clean,
          brand: parseProductJsonLd(html)?.brand ?? null,
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

    const products = new Set<string>();

    // 1. Sitemap first (cheap, complete, no crawling).
    for (const u of await collectSitemapUrls(domain)) {
      if (isProductUrl(u, key)) products.add(u.split('#')[0]);
    }

    // 2. No sitemap products -> shallow homepage -> category crawl.
    if (products.size === 0) {
      const root = `https://${domain.replace(/^www\./, '')}`;
      let home = await getText(`${root}/`, 20_000);
      if (!home) home = await getText(`https://www.${key}/`, 20_000);
      if (home) {
        const categories = unique(
          [...home.matchAll(/href="(https?:\/\/[^"]+)"/gi)]
            .map((m) => m[1])
            .filter((u) => u.includes(key) && /\/$/.test(u) && !NON_PRODUCT.test(u)),
        ).slice(0, MAX_CATEGORIES);
        await Promise.all(
          categories.map(async (cat) => {
            const html = await getText(cat, 20_000);
            if (!html) return;
            for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
              if (isProductUrl(m[1], key)) products.add(m[1].split('#')[0]);
            }
          }),
        );
      }
    }

    const urls = [...products].slice(0, MAX_PRODUCTS);
    this.caches.set(key, { at: Date.now(), urls });
    return urls;
  }
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
