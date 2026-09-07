import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFeed } from './feed-parse';
import {
  mapLimit,
  readVerdicts,
  RETENTION_MONTHS,
  stripSourceSuffix,
  windowStart,
  withinWindow,
} from './news-poll.service';
import { NEWS_CRIME_TYPES, NEWS_TAG_SCHEMA } from './news.types';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('readVerdicts — reading the model’s answer', () => {
  it('reads a well-formed batch', () => {
    const out = readVerdicts(
      JSON.stringify({
        items: [
          { index: 0, isCrime: true, crimeType: 'house robbery', places: ['Norkem Park'] },
          { index: 1, isCrime: false, crimeType: null, places: [] },
        ],
      }),
      2,
    );
    expect(out).toEqual([
      [0, { isCrime: true, crimeType: 'house robbery', places: ['Norkem Park'] }],
      [1, { isCrime: false, crimeType: null, places: [] }],
    ]);
  });

  // ⚠️ THE WHOLE REASON THE PAYLOAD IS INDEXED. A verdict for an item we did
  // not ask about would otherwise be applied to whatever sat at that position.
  it('drops a verdict for an index outside the batch', () => {
    const out = readVerdicts(
      JSON.stringify({ items: [{ index: 7, isCrime: true }] }),
      2,
    );
    expect(out).toEqual([]);
  });

  it('keeps the first answer when an index is repeated', () => {
    const out = readVerdicts(
      JSON.stringify({
        items: [
          { index: 0, isCrime: true, crimeType: 'murder', places: [] },
          { index: 0, isCrime: false, places: [] },
        ],
      }),
      1,
    );
    expect(out).toEqual([[0, { isCrime: true, crimeType: 'murder', places: [] }]]);
  });

  // A type nobody downstream expects is worse than 'other': the clipping is
  // still a real crime near the applicant, it is just unclassified.
  it('falls back to other for a crimeType outside the enum', () => {
    const out = readVerdicts(
      JSON.stringify({ items: [{ index: 0, isCrime: true, crimeType: 'arson' }] }),
      1,
    );
    expect(out[0][1].crimeType).toBe('other');
  });

  it('never carries a crimeType on a non-crime', () => {
    const out = readVerdicts(
      JSON.stringify({ items: [{ index: 0, isCrime: false, crimeType: 'murder' }] }),
      1,
    );
    expect(out[0][1].crimeType).toBeNull();
  });

  it('answers [] for prose, truncation or the wrong shape', () => {
    expect(readVerdicts('I could not do that', 3)).toEqual([]);
    expect(readVerdicts('{"items":[{"index":0,', 3)).toEqual([]);
    expect(readVerdicts(JSON.stringify({ verdicts: [] }), 3)).toEqual([]);
  });

  it('discards a places entry that is not a string', () => {
    const out = readVerdicts(
      JSON.stringify({
        items: [{ index: 0, isCrime: true, places: ['Brits', 42, '', null] }],
      }),
      1,
    );
    expect(out[0][1].places).toEqual(['Brits']);
  });
});

describe('NEWS_TAG_SCHEMA', () => {
  it('asks for an indexed array of verdicts', () => {
    expect(NEWS_TAG_SCHEMA.required).toEqual(['items']);
    const item = NEWS_TAG_SCHEMA.properties.items.items;
    expect(item.required).toEqual(['index', 'isCrime']);
    expect(Object.keys(item.properties)).toEqual([
      'index',
      'isCrime',
      'crimeType',
      'places',
    ]);
  });

  // ⚠️ The enum and the type union must not drift apart: the schema is what
  // the model is constrained by and NEWS_CRIME_TYPES is what the code trusts.
  it('constrains crimeType to exactly the declared types', () => {
    expect(NEWS_TAG_SCHEMA.properties.items.items.properties.crimeType.enum).toEqual([
      ...NEWS_CRIME_TYPES,
    ]);
  });
});

describe('the twelve-month window', () => {
  it('starts twelve months back', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(windowStart(RETENTION_MONTHS, now).toISOString()).toBe(
      '2025-09-07T00:00:00.000Z',
    );
  });

  it('keeps a clipping from inside the window and drops one from outside', () => {
    const inside = new Date();
    inside.setMonth(inside.getMonth() - 3);
    const outside = new Date();
    outside.setMonth(outside.getMonth() - 15);
    expect(withinWindow(inside)).toBe(true);
    expect(withinWindow(outside)).toBe(false);
  });

  // ⚠️ A MISSING DATE IS NOT EVIDENCE OF AGE. A feed that omits pubDate would
  // otherwise have every one of its items silently discarded.
  it('keeps an item the feed gave no date for', () => {
    expect(withinWindow(null)).toBe(true);
  });

  it('drops a date in the future beyond a day of clock skew', () => {
    const nextMonth = new Date(Date.now() + 30 * 86_400_000);
    expect(withinWindow(nextMonth)).toBe(false);
  });
});

describe('stripSourceSuffix — Google News headlines', () => {
  const item = parseFeed(fixture('feed-google-news.xml'))[0];

  it('reads the publisher out of <source>', () => {
    expect(item.sourceName).toBe('Rekord');
  });

  it('removes exactly the publisher Google appended', () => {
    expect(stripSourceSuffix(item.title, item.sourceName)).toBe(
      'Three held after Bronkhorstspruit farm attack',
    );
  });

  // ⚠️ THE OTHER PUBLISHER OF THIS HABIT: a WordPress og:title ends in
  // " | <paper>" for the browser tab, and printed under a masthead that
  // already names the paper it reads as a mistake.
  it('removes a masthead appended with a pipe or a dash', () => {
    expect(
      stripSourceSuffix(
        'CCTV leads to two arrests after Bassonia house robbery | Southern Courier',
        'Southern Courier',
      ),
    ).toBe('CCTV leads to two arrests after Bassonia house robbery');
    expect(stripSourceSuffix('Man shot in Ferndale – Randburg Sun', 'randburg sun')).toBe(
      'Man shot in Ferndale',
    );
  });

  // ⚠️ WHY THE EXACT NAME AND NOT A PATTERN: a real headline may end in a
  // dash-and-phrase, and a greedy rule would cut it off.
  it('leaves a headline alone when the suffix is not the publisher', () => {
    expect(stripSourceSuffix('Man held - police confirm', 'Rekord')).toBe(
      'Man held - police confirm',
    );
    expect(stripSourceSuffix('Man held - police confirm', null)).toBe(
      'Man held - police confirm',
    );
  });
});

describe('mapLimit', () => {
  it('runs everything, never more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      running -= 1;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('is a no-op on an empty list', async () => {
    await expect(mapLimit([], 5, async () => undefined)).resolves.toBeUndefined();
  });
});
