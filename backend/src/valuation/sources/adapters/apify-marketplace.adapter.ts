import { Injectable } from '@nestjs/common';
import { ApifyClient } from '../apify-client';
import { isRelevantAny, searchTerms } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

/** Search-URL builders per marketplace. */
const SEARCH_URL: Record<string, (q: string) => string> = {
  'gumtree.co.za': (q) => `https://www.gumtree.co.za/s-${encodeURIComponent(q.replace(/\s+/g, '-'))}`,
  'facebook.com': (q) => `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(q)}`,
};

/**
 * Extract (title, price) pairs from the plain text a rendered page returns.
 * Gumtree/Facebook prices may or may not carry a decimal ("R1 500" or
 * "R1,500.00"), so both are accepted here (unlike Gun Africa, whose markup
 * always carries a decimal and is parsed from a title attribute).
 */
export function extractRenderedListings(
  text: string,
  domain: string,
  query: SourceQuery,
): ProductHit[] {
  const hits: ProductHit[] = [];
  const seen = new Set<string>();
  const re = /(.{4,140}?)\sR\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[1].replace(/\s+/g, ' ').trim();
    const priceZar = Number(m[2].replace(/[ ,]/g, ''));
    if (!title || title.length < 4 || !priceZar || priceZar <= 0) continue;
    if (!isRelevantAny(title, query)) continue;
    const key = `${title}|${priceZar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      refId: hash(key),
      title,
      priceZar,
      domain,
      brand: null,
      model: null,
      productType: null,
      condition: null,
      available: null,
      listedDate: null,
    });
    if (hits.length >= query.limit) break;
  }
  return hits;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Gumtree / Facebook Marketplace via Apify. The universal content crawler
 * renders the search page (residential proxies defeat their anti-bot), and the
 * rendered text is parsed here. Inert unless VALUATION_APIFY_ENABLED=true and
 * APIFY_TOKEN is set, so it costs nothing until the lane is switched on.
 */
@Injectable()
export class ApifyMarketplaceAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'MARKETPLACE';
  readonly domains = ['gumtree.co.za', 'facebook.com', 'www.facebook.com'];

  constructor(private readonly apify: ApifyClient) {}

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    if (!this.apify.isConfigured()) return [];
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const key = domain.replace(/^www\./, '');
    const build = SEARCH_URL[key];
    if (!build) return [];

    const actor = process.env.APIFY_ACTOR_CONTENT_CRAWLER ?? 'apify/website-content-crawler';
    const items = await this.apify.runActor(actor, {
      startUrls: [{ url: build(terms.join(' ')) }],
      maxCrawlPages: 1,
      crawlerType: 'playwright:chrome',
    });
    const text = items
      .map((it) => {
        if (!it || typeof it !== 'object') return '';
        const o = it as Record<string, unknown>;
        return String(o.text ?? o.markdown ?? o.html ?? '');
      })
      .join('\n');
    if (!text) return [];
    return extractRenderedListings(text, domain, query).slice(0, query.limit);
  }
}
