import { Injectable } from '@nestjs/common';
import { getText } from '../http';
import { isRelevantAny, searchTerms } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

const TTL_MS = 12 * 60 * 60 * 1000;
/** Classifieds forums to read, and how many pages of each (50 topics/page). */
const FORUMS: Array<{ id: number; pages: number }> = [
  { id: 19, pages: 3 }, // "Advertensies Gratis vir lede" - the main classifieds
  { id: 130, pages: 6 }, // "Items"
  { id: 182, pages: 5 }, // "Ander Advertensies en Dienste"
  { id: 180, pages: 1 }, // "Jaracal Aanlyn Winkel"
];

interface Listing {
  refId: string;
  title: string;
  priceZar: number;
}

/** Price embedded in a classifieds topic title, e.g. "R 40,000.00" or "R5000-00". */
export function parseTitlePrice(title: string): number | null {
  // The `R` must not be the tail of a word ("CTR 308", "Stellar 3.0"), else the
  // model number reads as a price.
  const m = title.match(/(?:^|[^A-Za-z])R\s?(\d[\d ,]*(?:\.\d{2})?)/i);
  if (!m) return null;
  const digits = m[1].replace(/[ ,]+$/, '').replace(/\.\d{2}$/, '').replace(/[ ,]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * phpBB topic rows whose title carries a price. Pure, so it is unit-testable on
 * a fixture. The topic id is the refId so dupes across pages collapse.
 */
export function extractJaracalListings(html: string): Listing[] {
  const out: Listing[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href="[^"]*viewtopic\.php\?[^"]*?\bt=(\d+)[^"]*"[^>]*class="topictitle"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*class="topictitle"[^>]*href="[^"]*viewtopic\.php\?[^"]*?\bt=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1] ?? m[3];
    const raw = m[2] ?? m[4] ?? '';
    const title = raw.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (!id || !title || seen.has(id)) continue;
    const priceZar = parseTitlePrice(title);
    if (!priceZar) continue;
    seen.add(id);
    out.push({ refId: id, title, priceZar });
  }
  return out;
}

/**
 * Jaracal: a South African hunting/firearms forum. Guest search and feeds are
 * disabled, so discovery is a bounded crawl of its classifieds forums (newest
 * first), cached for 12h. Only listings whose TITLE carries a price are usable
 * (opening every topic to read a price is too many fetches). Used prices only.
 */
@Injectable()
export class JaracalAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'MARKETPLACE';
  readonly domains = ['jaracal.com'];

  private readonly caches = new Map<string, { at: number; items: Listing[] }>();

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const listings = await this.listings(domain);
    const out: ProductHit[] = [];
    for (const l of listings) {
      if (!isRelevantAny(l.title, query)) continue;
      out.push({
        refId: l.refId,
        title: l.title,
        priceZar: l.priceZar,
        domain,
        brand: null,
        model: null,
        productType: null,
        condition: null,
        available: null,
        listedDate: null,
        sold: false,
      });
      if (out.length >= query.limit) break;
    }
    return out;
  }

  private async listings(domain: string): Promise<Listing[]> {
    const key = domain.replace(/^www\./, '');
    const cached = this.caches.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.items;

    const urls: string[] = [];
    for (const f of FORUMS) {
      for (let p = 0; p < f.pages; p++) {
        urls.push(`https://${domain}/viewforum.php?f=${f.id}${p ? `&start=${p * 50}` : ''}`);
      }
    }
    const pages = await Promise.all(urls.map((u) => getText(u, 20_000)));
    const byId = new Map<string, Listing>();
    for (const html of pages) {
      if (!html) continue;
      for (const l of extractJaracalListings(html)) byId.set(l.refId, l);
    }
    const items = [...byId.values()];
    this.caches.set(key, { at: Date.now(), items });
    return items;
  }
}
