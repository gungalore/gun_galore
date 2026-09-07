import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFeed, parseFeedTitle, summarise, SUMMARY_MAX } from './feed-parse';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseFeed — RSS 2.0', () => {
  const items = parseFeed(fixture('feed-rss2.xml'));

  it('reads the items a newspaper feed carries', () => {
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe(
      'https://kemptonexpress.co.za/2026/09/06/norkem-park-house-robbery/',
    );
    expect(items[0].title).toBe('Two arrested after Norkem Park house robbery');
    expect(items[0].author).toBe('Thabo Nkosi');
    expect(items[0].publishedOn?.toISOString()).toBe('2026-09-06T05:15:00.000Z');
    expect(items[0].imageUrl).toBe(
      'https://kemptonexpress.co.za/wp-content/uploads/robbery.jpg',
    );
  });

  it('drops an item whose link is not an absolute http URL', () => {
    // The third item in the fixture. A relative link cannot be fetched, cannot
    // be deduplicated and cannot be printed under a clipping.
    expect(items.map((i) => i.url)).not.toContain('/not-absolute');
  });

  // ⚠️ THE PROMISE THE WHOLE FEATURE RESTS ON. WordPress puts the full article
  // in content:encoded and we index share previews only.
  it('never reads content:encoded', () => {
    const all = JSON.stringify(items);
    expect(all).not.toContain('FULL ARTICLE BODY');
  });

  it('strips markup and decodes entities out of the summary', () => {
    expect(items[0].summary).toBe(
      "The suspects fled in a white bakkie ’before’ police caught them. Continue reading",
    );
  });

  it('reads media:content when there is no enclosure', () => {
    expect(items[1].imageUrl).toBe(
      'https://kemptonexpress.co.za/wp-content/uploads/netball.jpg',
    );
  });

  it('names the feed', () => {
    expect(parseFeedTitle(fixture('feed-rss2.xml'))).toBe('Kempton Express');
  });
});

describe('parseFeed — Atom', () => {
  const items = parseFeed(fixture('feed-atom.xml'));

  it('reads entries', () => {
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Hijacking on the R40 near White River');
    expect(items[0].author).toBe('Marisa du Plessis');
    expect(items[0].summary).toBe('The driver was unharmed.');
  });

  // ⚠️ An Atom entry usually carries several <link>s and only one of them is
  // the article; taking the first would store the edit endpoint as the URL.
  it('takes the alternate link, not the first one', () => {
    expect(items[0].url).toBe('https://lowvelder.co.za/2026/09/04/r40-hijacking/');
  });

  it('falls back to updated when there is no published date', () => {
    expect(items[1].publishedOn?.toISOString()).toBe('2026-09-03T09:00:00.000Z');
  });
});

describe('parseFeed — hostile input', () => {
  it('answers [] rather than throwing when a publisher serves HTML', () => {
    expect(parseFeed('<!doctype html><html><body>nope</body></html>')).toEqual([]);
  });

  it('answers [] for an empty body', () => {
    expect(parseFeed('')).toEqual([]);
  });
});

describe('summarise', () => {
  it('bounds a long standfirst at a word and marks the cut', () => {
    const long = `${'word '.repeat(200)}end`;
    const out = summarise(long)!;
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('is null for nothing at all', () => {
    expect(summarise(null)).toBeNull();
    expect(summarise('   ')).toBeNull();
  });
});
