import { describe, expect, it } from 'vitest';
import {
  CLIPPING_LIMIT_REASON,
  MAX_CLIPPINGS,
  crimeTypeLabel,
  formatDistanceKm,
  formatPublishedOn,
  incidentMetaLine,
  parseClippingIds,
  serialiseClippingIds,
  toggleClippingId,
} from './press-clippings';

describe('parseClippingIds', () => {
  it('reads a plain JSON array of ids', () => {
    expect(parseClippingIds('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for null, undefined and blank input', () => {
    expect(parseClippingIds(null)).toEqual([]);
    expect(parseClippingIds(undefined)).toEqual([]);
    expect(parseClippingIds('')).toEqual([]);
    expect(parseClippingIds('   ')).toEqual([]);
  });

  it('returns [] for invalid JSON rather than throwing', () => {
    expect(parseClippingIds('{not json')).toEqual([]);
    expect(parseClippingIds('undefined')).toEqual([]);
  });

  it('returns [] when the JSON parses but is not an array', () => {
    expect(parseClippingIds('{"a":1}')).toEqual([]);
    expect(parseClippingIds('"a string"')).toEqual([]);
    expect(parseClippingIds('42')).toEqual([]);
  });

  it('drops non-string and empty-string entries', () => {
    expect(parseClippingIds('["a", 1, null, "", "b"]')).toEqual(['a', 'b']);
  });

  it('de-duplicates, keeping the first occurrence', () => {
    expect(parseClippingIds('["a","b","a","c","b"]')).toEqual(['a', 'b', 'c']);
  });

  it('caps at MAX_CLIPPINGS', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `id${i}`);
    const parsed = parseClippingIds(JSON.stringify(ids));
    expect(parsed).toHaveLength(MAX_CLIPPINGS);
    expect(parsed).toEqual(ids.slice(0, MAX_CLIPPINGS));
  });
});

describe('serialiseClippingIds', () => {
  it('writes a plain JSON array', () => {
    expect(serialiseClippingIds(['a', 'b'])).toBe('["a","b"]');
  });

  it('de-duplicates and caps on the way out too', () => {
    const ids = ['a', 'a', ...Array.from({ length: 10 }, (_, i) => `x${i}`)];
    const out = JSON.parse(serialiseClippingIds(ids));
    expect(out).toHaveLength(MAX_CLIPPINGS);
    expect(new Set(out).size).toBe(out.length);
  });

  it('round-trips through parseClippingIds', () => {
    const ids = ['a', 'b', 'c'];
    expect(parseClippingIds(serialiseClippingIds(ids))).toEqual(ids);
  });
});

describe('toggleClippingId', () => {
  it('appends a new id to the end — click order, not list order', () => {
    expect(toggleClippingId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleClippingId(['b', 'a'], 'c')).toEqual(['b', 'a', 'c']);
  });

  it('removes an id already selected', () => {
    expect(toggleClippingId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('is a no-op past the cap for an id not already selected', () => {
    const full = Array.from({ length: MAX_CLIPPINGS }, (_, i) => `id${i}`);
    expect(toggleClippingId(full, 'new')).toEqual(full);
  });

  it('can still remove one while at the cap', () => {
    const full = Array.from({ length: MAX_CLIPPINGS }, (_, i) => `id${i}`);
    expect(toggleClippingId(full, 'id3')).toEqual(
      full.filter((x) => x !== 'id3'),
    );
  });

  it('re-adding a removed id puts it back at the end', () => {
    const withB = toggleClippingId(['a', 'b', 'c'], 'b');
    expect(toggleClippingId(withB, 'b')).toEqual(['a', 'c', 'b']);
  });
});

describe('CLIPPING_LIMIT_REASON', () => {
  it('names the actual cap', () => {
    expect(CLIPPING_LIMIT_REASON).toContain(String(MAX_CLIPPINGS));
  });
});

describe('crimeTypeLabel', () => {
  it('returns null for null', () => {
    expect(crimeTypeLabel(null)).toBeNull();
  });

  it('sentence-cases a snake_case classifier value', () => {
    expect(crimeTypeLabel('armed_robbery')).toBe('Armed robbery');
  });

  it('sentence-cases a hyphenated value', () => {
    expect(crimeTypeLabel('house-robbery')).toBe('House robbery');
  });

  it('normalises already-capitalised prose to the same shape', () => {
    expect(crimeTypeLabel('Armed Robbery')).toBe('Armed robbery');
  });
});

describe('formatDistanceKm', () => {
  it('returns null when there is no distance', () => {
    expect(formatDistanceKm(null)).toBeNull();
  });

  it('rounds to the nearest whole kilometre', () => {
    expect(formatDistanceKm(3.4)).toBe('3 km away');
    expect(formatDistanceKm(3.6)).toBe('4 km away');
  });

  it('never renders a negative distance', () => {
    expect(formatDistanceKm(-1)).toBe('0 km away');
  });
});

describe('formatPublishedOn', () => {
  it('renders day, short month and year', () => {
    expect(formatPublishedOn('2026-03-12T08:00:00Z')).toBe('12 Mar 2026');
  });

  it('falls back to the raw string for something unparsable', () => {
    expect(formatPublishedOn('not-a-date')).toBe('not-a-date');
  });
});

describe('incidentMetaLine', () => {
  it('leads with distance when known', () => {
    expect(
      incidentMetaLine({
        distanceKm: 3,
        sourceName: 'Lowvelder',
        publishedOn: '2026-03-12T08:00:00Z',
      }),
    ).toBe('3 km away · Lowvelder · 12 Mar 2026');
  });

  it('skips distance, not blanks it, when unknown', () => {
    expect(
      incidentMetaLine({
        distanceKm: null,
        sourceName: 'Lowvelder',
        publishedOn: '2026-03-12T08:00:00Z',
      }),
    ).toBe('Lowvelder · 12 Mar 2026');
  });
});
