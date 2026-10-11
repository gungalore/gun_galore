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
 * Is this product title plausibly the item? Requires the make as a PHRASE
 * ("blue marlin", so "BOURBON Cap Blue Marlin" is not a Blue Marlin rod) AND at
 * least one distinctive model token as a WHOLE WORD ("g3", not "magnet3").
 * Strict by design: a loose match let unrelated products become comparables.
 */
export function isRelevant(title: string, q: SourceQuery): boolean {
  const t = normalize(title);
  const make = normalize(q.make);
  const model = distinctiveTokens(q.model);

  if (make) {
    if (!t.includes(make)) return false;
    if (model.length && !model.some((tk) => hasWord(t, tk))) return false;
    return true;
  }
  if (model.length) return model.some((tk) => hasWord(t, tk));
  const ks = distinctiveTokens(q.keySpec);
  return ks.length > 0 && ks.some((tk) => hasWord(t, tk));
}

/**
 * Looser variant for sources whose search is ALREADY scoped server-side (a
 * `?combine=` classifieds query). Accepts any distinctive token as a word, but
 * still ignores stopwords so a colour word cannot pull in the whole catalog.
 */
export function isRelevantAny(title: string, q: SourceQuery): boolean {
  const t = normalize(title);
  const terms = searchTerms(q);
  return terms.length > 0 && terms.some((tk) => hasWord(t, tk));
}
