import { Injectable } from '@nestjs/common';
import { getHtml } from '../http';
import { isRelevantAny, searchTerms } from '../relevance';
import { ProductHit, SourceAdapter, SourcePlatform, SourceQuery } from '../types';

/**
 * Gun Africa renders each listing as an anchor whose title attribute carries
 * the price. Two shapes occur:
 *   featured: title="Sig Sauer M4, R 40,000.00"
 *   search:   title="Revolvers, Revolvers, RUGER SUPER BLACKHAWK , R 8,500.00,
 *                     Ruger, New model super blackhawk, Like New, South Africa, ..."
 * The item title is the field just before the price; the trailing fields are
 * make, model and condition. Pure function so it can be tested on a fixture.
 */
export function extractGunAfricaListings(
  html: string,
  domain: string,
  query: SourceQuery,
): ProductHit[] {
  const hits: ProductHit[] = [];
  const seen = new Set<string>();
  const attrRe = /title="([^"]+)"/g;
  const priceRe = /R\s?\d{1,3}(?:[ ,]\d{3})*\.\d{2}/;
  let m: RegExpExecArray | null;

  while ((m = attrRe.exec(html)) !== null) {
    const attr = decodeEntities(m[1]);
    const pm = priceRe.exec(attr);
    if (!pm || pm.index == null) continue;
    const priceZar = Number(pm[0].replace(/[^0-9.]/g, ''));
    if (!priceZar || priceZar <= 0) continue;

    const title = lastField(attr.slice(0, pm.index));
    if (!title || title.length < 4 || !isRelevantAny(title, query)) continue;

    const rest = attr
      .slice(pm.index + pm[0].length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const key = `${title}|${priceZar}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      refId: hash(key),
      title,
      priceZar,
      domain,
      brand: rest[0] ?? null,
      model: rest[1] ?? null,
      productType: null,
      condition: mapCondition(rest[2]),
      available: null,
      listedDate: null,
    });
    if (hits.length >= query.limit) break;
  }
  return hits;
}

function lastField(s: string): string {
  const parts = s.split(',');
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].trim();
    if (t) return t;
  }
  return '';
}

function mapCondition(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/brand new|^new$/.test(t)) return 'NEW';
  if (/like new|as new|excellent/.test(t)) return 'EXCELLENT';
  if (/good/.test(t)) return 'GOOD';
  if (/fair/.test(t)) return 'FAIR';
  if (/poor|parts|not working/.test(t)) return 'POOR';
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Gun Africa: a South African secondhand firearms/outdoor classifieds site. Its
 * pages are server-rendered and robots-permissive, so a plain GET is enough.
 * Used prices only: every hit is a USED_COMP.
 */
@Injectable()
export class GunAfricaAdapter implements SourceAdapter {
  readonly platform: SourcePlatform = 'MARKETPLACE';
  readonly domains = ['gunafrica.co.za'];

  async search(domain: string, query: SourceQuery): Promise<ProductHit[]> {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    const url = `https://${domain}/classifieds?combine=${encodeURIComponent(terms.join(' '))}`;
    const html = await getHtml(url);
    if (!html) return [];
    return extractGunAfricaListings(html, domain, query).slice(0, query.limit);
  }
}
