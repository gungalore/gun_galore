import { Injectable } from '@nestjs/common';
import { stripTags } from '../http';
import { isRelevant } from '../relevance';
import { collectSitemapUrls, slugMatches } from '../sitemap-jsonld';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';
import { parseHtmlName, parseHtmlPrice } from './html-catalog.adapter';
import { ScrapewiseClient } from '../scrapewise-client';

const TTL_MS = 12 * 60 * 60 * 1000;
/** Cap pages fetched per source per valuation — each is a billed render. */
const MAX_FETCH = 6;

const NON_PRODUCT =
  /\/(customer|checkout|cart|wishlist|compare|catalog|brands?|blog|news|about|contact|help|faq|privacy|policy|terms|account|login|register|newsletter|stores?|shipping|delivery|returns|careers|product-guides|gallery|form|gift|search)\b/i;

/** First ZAR amount in the page's visible text — fallback when no structured price. */
export function priceFromText(html: string): number | null {
  const m = stripTags(html).match(/(?:^|[^A-Za-z0-9])R\s?(\d[\d ,]*(?:\.\d{2})?)/);
  if (!m) return null;
  const digits = m[1].replace(/[ ,]+$/, '').replace(/\.\d{2}$/, '').replace(/[ ,]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isProductUrl(url: string, host: string): boolean {
  try {
    const x = new URL(url);
    if (x.hostname.replace(/^www\./, '') !== host) return false;
    if (url.includes('?')) return false;
    const path = x.pathname;
    if (path.endsWith('/') || path.split('/').filter(Boolean).length === 0) return false;
    if (NON_PRODUCT.test(path)) return false;
    if (/\.(xml|json|jpg|jpeg|png|gif|webp|css|js|pdf|ico|svg)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders a page through the Scrapewise MCP gateway and reads its ZAR price —
 * the lane for shops our plain fetch cannot read (JS/SPA storefronts and
 * Cloudflare-fronted sites like Futurama). Discovery is cheap (sitemap via our
 * own fetch, or one rendered homepage); only slug-matched product pages are
 * rendered through Scrapewise, so each valuation spends a few pages at most.
 * New-price anchors only; the candidate list is cached 12h.
 */
@Injectable()
export class ScrapewiseAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'SCRAPEWISE';

  private readonly caches = new Map<string, { at: number; urls: string[] }>();

  constructor(private readonly client: ScrapewiseClient) {}

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    if (!this.client.isConfigured()) return [];
    const urls = await this.candidateUrls(domain);
    if (urls.length === 0) return [];

    const candidates = urls
      .filter((u) => slugMatches(u, query))
      .slice(0, Math.min(Math.max(query.limit, 1) * 2, MAX_FETCH));
    if (candidates.length === 0) return [];

    const clean = domain.replace(/^www\./, '');
    const hits: ProductHit[] = [];
    for (const url of candidates) {
      const html = await this.client.fetchPage(url, 'html');
      if (!html) continue;
      const priceZar = parseHtmlPrice(html) ?? priceFromText(html);
      const title = parseHtmlName(html);
      if (!priceZar || priceZar <= 0 || !title) continue;
      if (!isRelevant(title, query)) continue;
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
    }
    return hits.slice(0, query.limit);
  }

  private async candidateUrls(domain: string): Promise<string[]> {
    const key = domain.replace(/^www\./, '');
    const cached = this.caches.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.urls;

    const products = new Set<string>();
    for (const u of await collectSitemapUrls(domain)) {
      if (isProductUrl(u, key)) products.add(u.split('#')[0]);
    }
    if (products.size === 0) {
      const home = await this.client.fetchPage(`https://${key}/`, 'html');
      if (home) {
        for (const m of home.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
          if (isProductUrl(m[1], key)) products.add(m[1].split('#')[0]);
        }
      }
    }
    const urls = [...products];
    this.caches.set(key, { at: Date.now(), urls });
    return urls;
  }
}
