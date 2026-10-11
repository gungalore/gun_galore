import { SourceQuery } from './types';

/**
 * Words too generic to prove a match: colours and filler that appear across a
 * whole catalog. Used only for the model/keySpec tokens (the make is matched as
 * a phrase, so a colour inside a brand name like "Blue Marlin" is kept).
 */
const STOP = new Set([
  'blue','black','white','green','red','grey','gray','tan','camo','pink','orange','yellow','brown','silver','gold',
  'series','gen','generation','pro','lite','max','plus','ultra','mini','super','and','the','for','with','new','used',
  'set','kit','pack','oz','mm','cm','in',
]);

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Distinctive lowercase tokens from a field (drops stopwords and pure numbers). */
export function distinctiveTokens(s: string | null | undefined): string[] {
  return normalize(s)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Whole-word test, so token "g3" does not match inside "magnet3". */
function hasWord(haystack: string, token: string): boolean {
  return new RegExp(`(^| )${escapeRe(token)}( |$)`).test(haystack);
}

/** Query terms used to search a source (distinctive make + model + keySpec). */
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
 * Can this query identify a specific product, or is it only a brand? A brand
 * alone is too weak: "redding" matches every Redding die set, brush and pin.
 * Make tokens are REMOVED from the result, because a model like "Redding Boss"
 * carries the maker word and would otherwise match the whole brand again.
 */
function productTokens(q: SourceQuery): string[] {
  const make = new Set(distinctiveTokens(q.make));
  const model = distinctiveTokens(q.model).filter((t) => !make.has(t));
  if (model.length) return model;
  return distinctiveTokens(q.keySpec).filter((t) => !make.has(t));
}

/**
 * Is this product title plausibly the item? Requires the make as a PHRASE
 * ("blue marlin") AND a model (or keySpec) token as a WHOLE WORD. A brand with
 * no model/keySpec is rejected outright, because otherwise every product from
 * that brand becomes a comparable.
 */
export function isRelevant(title: string, q: SourceQuery): boolean {
  const t = normalize(title);
  const make = normalize(q.make);
  const product = productTokens(q);

  if (make) {
    if (!t.includes(make)) return false;
    return product.length > 0 && product.some((tk) => hasWord(t, tk));
  }
  if (product.length) return product.some((tk) => hasWord(t, tk));
  return false;
}

/**
 * Looser variant for sources whose search is ALREADY scoped server-side (a
 * `?combine=` classifieds query). Accepts any distinctive token as a word, but
 * still ignores stopwords and still requires a model/keySpec so a brand word
 * cannot pull in the whole catalogue.
 */
export function isRelevantAny(title: string, q: SourceQuery): boolean {
  const t = normalize(title);
  const product = productTokens(q);
  if (product.length === 0) return false;
  const terms = [...new Set([...distinctiveTokens(q.make), ...product])];
  return terms.some((tk) => hasWord(t, tk));
}
