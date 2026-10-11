import { SourceQuery } from './types';

/**
 * Words too generic to prove a match: colours and filler that appear across a
 * whole catalog. "Blue Marlin" must not match every blue product, and
 * "G3 Series" must not match every "series". Distinctive tokens only.
 */
const STOP = new Set([
  'blue','black','white','green','red','grey','gray','tan','camo','pink','orange','yellow','brown','silver','gold',
  'series','gen','generation','pro','lite','max','plus','ultra','mini','super','and','the','for','with','new','used',
  'set','kit','pack','oz','mm','cm','in',
]);

/** Distinctive lowercase tokens from a field (drops stopwords and pure numbers). */
export function distinctiveTokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Query terms used to search a source (make + model + keySpec, distinctive). */
export function searchTerms(q: SourceQuery): string[] {
  return [
    ...new Set([
      ...distinctiveTokens(q.make),
      ...distinctiveTokens(q.model),
      ...distinctiveTokens(q.keySpec),
    ]),
  ];
}

/**
 * Is this product title plausibly the item? Requires EVERY distinctive make
 * token AND at least one distinctive model token. This is deliberately strict:
 * a loose match let unrelated products (a "blue" tarpaulin) become comparables.
 * Falls back to keySpec terms only when neither make nor model is known.
 */
export function isRelevant(title: string, q: SourceQuery): boolean {
  const t = title.toLowerCase();
  const make = distinctiveTokens(q.make);
  const model = distinctiveTokens(q.model);
  if (make.length && !make.every((tk) => t.includes(tk))) return false;
  if (model.length && !model.some((tk) => t.includes(tk))) return false;
  if (!make.length && !model.length) {
    const ks = distinctiveTokens(q.keySpec);
    return ks.length > 0 && ks.some((tk) => t.includes(tk));
  }
  return true;
}

/**
 * Looser variant for sources whose search is ALREADY scoped server-side (a
 * `?combine=` classifieds query). Accepts any distinctive token, but still
 * ignores stopwords so a colour word cannot pull in the whole catalog.
 */
export function isRelevantAny(title: string, q: SourceQuery): boolean {
  const t = title.toLowerCase();
  const terms = searchTerms(q);
  return terms.length > 0 && terms.some((tk) => t.includes(tk));
}
