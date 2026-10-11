import { Injectable } from '@nestjs/common';
import { getText } from '../http';
import { isRelevant, searchTerms } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

const SITEMAP_URL = (domain: string) => `https://${domain.replace(/^www\./, '')}/sitemap.xml`;
const SITEMAP_TTL_MS = 12 * 60 * 60 * 1000;

/** Pull the Product node out of a page's JSON-LD. Pure; unit-tested. */
export function parseProductJsonLd(
  html: string,
): { name?: string; brand?: string; priceZar?: number; available?: string } | null {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(b[1]);
    } catch {
      continue;
    }
    const nodes: unknown[] = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['@graph'])
        ? ((data as Record<string, unknown>)['@graph'] as unknown[])
        : [data];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const o = n as Record<string, unknown>;
      if (o['@type'] !== 'Product') continue;
      const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
      const off = (offers ?? {}) as Record<string, unknown>;
      const price = off.price ?? o.price;
      const brand = o.brand as Record<string, unknown> | string | undefined;
      return {
        name: typeof o.name === 'string' ? o.name : undefined,
        brand: typeof brand === 'string' ? brand : (brand?.name as string | undefined),
        priceZar: price != null ? Number(price) : undefined,
        available: (off.availability as string | undefined) ?? undefined,
      };
    }
  }
  return null;
}

/** Fallback: Outdoor Warehouse embeds a value/currency/name JSON in meta tags. */
export function parseCustomData(html: string): { name?: string; priceZar?: number } | null {
  const m = html.match(/"value":(\d+),"currency":"ZAR","content_name":"([^"]*)"/);
  if (!m) return null;
  return { priceZar: Number(m[1]), name: m[2] };
}

/**
 * Outdoor Warehouse (outdoorwarehouse.co.za): a custom Vue storefront. Its
 * /products.json is a bespoke object, but the product sitemap lists every
 * /product/<slug>/ page and each page server-renders a Product JSON-LD block
 * (with offers.price) plus an embedded value/currency/name. So discovery is
 * "slug index + match", then a plain GET per matched product. No Apify.
 */
@Injectable()
export class OutdoorWarehouseAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'SITEMAP_HTML';
  readonly domains = ['outdoorwarehouse.co.za', 'www.outdoorwarehouse.co.za'];

  private cache: { at: number; domain: string; urls: string[] } | null = null;

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const urls = await this.productUrls(domain);
    if (urls.length === 0) return [];

    const candidates = urls
      .filter((u) => slugMatches(u, terms))
      .slice(0, Math.min(Math.max(query.limit, 1) * 2, 40));
    if (candidates.length === 0) return [];

    const hits: ProductHit[] = [];
    await Promise.all(
      candidates.map(async (url) => {
        const html = await getText(url, 12_000);
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
    if (this.cache && this.cache.domain === key && Date.now() - this.cache.at < SITEMAP_TTL_MS) {
      return this.cache.urls;
    }
    const xml = await getText(SITEMAP_URL(domain), 20_000);
    if (!xml) return [];
    const urls = [...xml.matchAll(/<loc>(https?:\/\/[^<]*\/product\/[^<]+)<\/loc>/gi)].map((m) =>
      m[1].trim(),
    );
    this.cache = { at: Date.now(), domain: key, urls };
    return urls;
  }
}

function slugMatches(url: string, terms: string[]): boolean {
  const seg = url.replace(/\/$/, '').split('/').pop() ?? '';
  const slug = decodeURIComponent(seg).replace(/-/g, ' ').toLowerCase();
  return terms.some((t) => slug.includes(t));
}
