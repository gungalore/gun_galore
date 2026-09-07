// ────────────────────────────────────────────────────────────────────
// SPELLING A STATION THE WAY SAPS SPELLS IT.
//
// SAPS's workbook says "Brooklyn". Google Places says "Brooklyn Police
// Station", or "SAPS Brooklyn", or "Brooklyn SAPS", or occasionally
// "South African Police Service - Brooklyn". A member types "brooklyn police
// station pretoria". All four have to reach the same row.
//
// Pure, so the matching rules can be tested without a Places key.
// ────────────────────────────────────────────────────────────────────

/** Combining marks left behind by NFD, so "Mokopane" and "Mokopané" agree. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * ⚠️ ORDER MATTERS AND THE LONGEST PHRASE MUST GO FIRST. Strip "police"
 * before "south african police service" and the leftover "south african
 * service" no longer matches anything.
 */
const NOISE: RegExp[] = [
  /south african police service/g,
  /\bsapd\b/g,
  /\bsaps\b/g,
  /\bpolice station\b/g,
  /\bpolisiestasie\b/g,
  /\bpolice\b/g,
  /\bpolisie\b/g,
  /\bstasie\b/g,
  /\bstation\b/g,
];

function fold(raw: string): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase();
}

/**
 * A comparable key: no accents, no punctuation, no "police station", no
 * doubled spaces.
 *
 * ⚠️ "Station" IS STRIPPED EVEN THOUGH IT COULD BE PART OF A REAL NAME.
 * No station in the 2025-2026 Q4 workbook (1 174 of them) carries the word,
 * and the alternative — leaving it in — means "Brooklyn Police Station" never
 * matches "Brooklyn", which is the case this function exists for.
 */
export function normaliseStationName(raw: string): string {
  // Places sometimes appends the suburb after a comma. The name is the part
  // before it.
  let s = fold(raw).split(',')[0];
  for (const re of NOISE) s = s.replace(re, ' ');
  return s
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Structural words in an address that can never be the name of a precinct:
 * street types, unit words, the country.
 *
 * ⚠️ PROVINCE AND CITY WORDS ARE DELIBERATELY *NOT* HERE. "Cape Town Central"
 * and "Table View" are real stations, and dropping "cape" or "west" to be tidy
 * would make the two-word candidates that find them impossible to build.
 */
const ADDRESS_NOISE = new Set([
  'south',
  'africa',
  'street',
  'straat',
  'road',
  'weg',
  'avenue',
  'laan',
  'drive',
  'lane',
  'close',
  'crescent',
  'boulevard',
  'way',
  'unit',
  'flat',
  'apt',
  'block',
  'erf',
  'plot',
  'the',
  'and',
  'for',
  'near',
  'home',
  'house',
  'province',
]);

/**
 * Candidate place tokens from a free-text address, longest phrase first.
 * Returns adjacent word PAIRS before single words, because plenty of stations
 * are two words and "Table View" must beat "Table" and "View" separately.
 *
 * Used only by the fallback path — when there is no Places key, or Places
 * found nothing we hold.
 */
export function addressPlaceTokens(address: string): string[] {
  const words = fold(address)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !ADDRESS_NOISE.has(w));

  const pairs: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    pairs.push(`${words[i]} ${words[i + 1]}`);
  }
  return [...pairs, ...words];
}
