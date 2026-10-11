import { SourceQuery } from './types';

/** Query terms (individual tokens) from make/model/keySpec. */
export function searchTerms(q: SourceQuery): string[] {
  return [q.make, q.model, q.keySpec]
    .map((v) => (v ?? '').toLowerCase().trim())
    .filter((v) => v.length >= 2)
    .flatMap((v) => v.split(/\s+/))
    .filter((v) => v.length >= 2);
}

/**
 * Is this product title plausibly the item? If a model is known it must appear
 * (as the whole model string or its main token); otherwise any spec term must
 * appear. This keeps a store catalog from dumping unrelated rows into the
 * pricing pool when make/model are unknown.
 */
export function isRelevant(title: string, q: SourceQuery): boolean {
  const t = title.toLowerCase();
  const model = (q.model ?? '').toLowerCase().trim();
  if (model.length >= 3) {
    const tokens = model.split(/\s+/).filter((x) => x.length >= 3);
    if (!t.includes(model) && !tokens.some((tok) => t.includes(tok))) return false;
  }
  const terms = searchTerms(q);
  if (terms.length === 0) return model.length >= 3;
  return terms.some((term) => t.includes(term));
}

/**
 * Looser variant for sources whose search is ALREADY scoped server-side (for
 * example a `?combine=` classifieds query): accept if ANY term appears. Titles
 * on such sites are loose auction-style descriptions, so the strict model
 * requirement would drop genuine matches.
 */
export function isRelevantAny(title: string, q: SourceQuery): boolean {
  const t = title.toLowerCase();
  const terms = searchTerms(q);
  if (terms.length === 0) return false;
  return terms.some((term) => t.includes(term));
}
