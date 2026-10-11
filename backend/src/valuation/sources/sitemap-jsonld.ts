import { getText } from './http';
import { distinctiveTokens } from './relevance';
import { SourceQuery } from './types';

/**
 * Shared helpers for retailers that expose no product API but do publish a
 * sitemap and server-render a schema.org Product JSON-LD block per product
 * (Outdoor Warehouse, Safari Outdoor/Magento, ...). Discovery is "sitemap index
 * + slug match"; the price is read from the product page's JSON-LD.
 */

export interface ProductLd {
  name?: string;
  brand?: string;
  priceZar?: number;
  available?: string;
}

/** Pull the Product node (preferring one with an offer price) from a page. */
export function parseProductJsonLd(html: string): ProductLd | null {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  let fallback: ProductLd | null = null;
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
      const ld: ProductLd = {
        name: typeof o.name === 'string' ? o.name : undefined,
        brand: typeof brand === 'string' ? brand : (brand?.name as string | undefined),
        priceZar: price != null ? Number(price) : undefined,
        available: (off.availability as string | undefined) ?? undefined,
      };
      if (ld.priceZar) return ld;
      if (!fallback) fallback = ld;
    }
  }
  return fallback;
}

/** Fallback for sites that embed a value/currency/name JSON in a meta tag. */
export function parseCustomData(html: string): { name?: string; priceZar?: number } | null {
  const m = html.match(/"value":(\d+(?:\.\d+)?),"currency":"ZAR","content_name":"([^"]*)"/);
  if (!m) return null;
  return { priceZar: Number(m[1]), name: m[2] };
}

/**
 * Fetch every URL in a site's sitemap, following a sitemap index into its
 * sub-sitemaps. Cached per domain for 12h by the calling adapter.
 */
export async function collectSitemapUrls(domain: string, timeoutMs = 20_000): Promise<string[]> {
  const root = `https://${domain.replace(/^www\./, '')}`;
  const xml = await getText(`${root}/sitemap.xml`, timeoutMs);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
  if (locs.length === 0) return [];

  const isIndex = locs.every((u) => /\.xml$/i.test(u));
  if (!isIndex) return locs;

  const all = new Set<string>();
  for (const sub of locs.slice(0, 6)) {
    const sx = await getText(sub, timeoutMs);
    if (!sx) continue;
    for (const m of sx.matchAll(/<loc>([^<]+)<\/loc>/gi)) all.add(m[1].trim());
  }
  return [...all];
}

/** Does a product URL's final slug segment name the item? Requires every
 * distinctive make token and a model (or keySpec) token, so "Redding Boss"
 * does not select every Redding die set or every Hatsan "Boss" air rifle. */
export function slugMatches(url: string, query: SourceQuery): boolean {
  const slug = decodeURIComponent(url.replace(/\/$/, '').split('/').pop() ?? '')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
  const make = distinctiveTokens(query.make);
  if (make.length && !make.every((t) => slug.includes(t))) return false;
  const model = distinctiveTokens(query.model).filter((t) => !make.includes(t));
  const ks = distinctiveTokens(query.keySpec).filter((t) => !make.includes(t));
  const product = model.length ? model : ks;
  return product.length > 0 && product.some((t) => slug.includes(t));
}
