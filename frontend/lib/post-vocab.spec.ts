import { describe, expect, it } from 'vitest';
import { entriesFor, labelFor, matchEntries, type VocabKey } from './post-vocab';

const KEYS: VocabKey[] = [
  'species-hunting',
  'species-fishing',
  'flair-general',
  'flair-firearms',
  'flair-fishing',
  'flair-overlanding',
  'flair-camping',
  'flair-questions',
  'firearm-type',
  'water-type',
  'site-type',
  'gear-category',
  'gear-condition',
  'context',
  'test-result',
  'cartridge',
];

describe('post-vocab', () => {
  it('has entries for every key', () => {
    for (const key of KEYS) {
      expect(entriesFor(key).length, key).toBeGreaterThan(0);
    }
  });

  it('returns no suggestions for an empty query', () => {
    expect(matchEntries('', entriesFor('species-hunting'))).toEqual([]);
    expect(matchEntries('   ', entriesFor('species-hunting'))).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(matchEntries('zzzzqqq', entriesFor('species-hunting'))).toEqual([]);
  });

  it('matches an alias exactly and ranks it first', () => {
    const hits = matchEntries('geelbek', entriesFor('species-fishing'));
    expect(hits[0]?.value).toBe('dusky-kob');
  });

  it('matches an Afrikaans alias', () => {
    const hits = matchEntries('rooibok', entriesFor('species-hunting'));
    expect(hits[0]?.value).toBe('impala');
  });

  it('folds punctuation and case (cartridges)', () => {
    // "6,5 creedmoor" and "6.5 creedmoor" fold to the same haystack.
    const a = matchEntries('6,5 creedmoor', entriesFor('cartridge'));
    const b = matchEntries('6.5 Creedmoor', entriesFor('cartridge'));
    expect(a[0]?.value).toBe(b[0]?.value);
    expect(a[0]?.value).toBeTruthy();
  });

  it('caps the number of suggestions', () => {
    expect(matchEntries('a', entriesFor('species-hunting'), 3)).toHaveLength(3);
  });

  it('exposes a display label for a stored value', () => {
    expect(labelFor('species-hunting', 'greater-kudu')).toBe('Greater kudu');
    expect(labelFor('species-hunting', 'unicorn')).toBeUndefined();
  });
});
