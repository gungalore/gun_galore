import { RawComp } from '../schemas';
import { diffProduct } from './diff-product';
import { ItemSpec, ProductHit, SourceRole } from './types';

/**
 * A source's roles decide whether its prices are new (anchor) or used. A single
 * hit can override when it is explicitly sold (used) or explicitly new stock.
 */
export function hitKind(hit: ProductHit, roles: SourceRole[]): RawComp['kind'] {
  if (hit.sold) return 'USED_COMP';
  if (hit.isNew) return 'RETAIL_ANCHOR';
  if (roles.includes('ANCHOR') && !roles.includes('USED')) return 'RETAIL_ANCHOR';
  return 'USED_COMP';
}

/**
 * Map an external hit to the RawComp the pricing engine consumes. The URL is a
 * synthetic, non-revealing key (never a real listing URL), so nothing we store
 * can leak a source or be re-crawled.
 */
export function toRawComp(hit: ProductHit, roles: SourceRole[], item: ItemSpec): RawComp {
  const name = [hit.brand, hit.model].filter(Boolean).join(' ').trim();
  return {
    kind: hitKind(hit, roles),
    sourceSite: hit.domain,
    url: `src://${hit.domain}/${hit.refId}`,
    model: name || hit.title,
    condition: hit.condition ?? null,
    priceZar: Math.max(0, Math.round(hit.priceZar)),
    listedDate: hit.listedDate ?? null,
    pageOpened: true,
    match: { diffs: diffProduct({ brand: hit.brand, model: hit.model, attributes: hit.attributes }, item) },
  };
}
