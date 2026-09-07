import { XMLParser } from 'fast-xml-parser';

// ────────────────────────────────────────────────────────────────────
// READING A NEWSPAPER'S FEED.
//
// ⚠️ ONE PARSER, PINNED: fast-xml-parser. rss-parser was the alternative and
// would have brought its own fetch, its own timeout policy and its own idea
// of what a "custom field" is; this file needs none of that, because the poll
// already owns the fetch (see news-poll.service.ts — 20 s, 5 MB, browser UA).
// A feed reader that also fetches is a feed reader you cannot test offline.
//
// ⚠️ RSS 2.0 AND ATOM BOTH, because South African publishers ship both:
// 74 of the feeds in the registry are WordPress RSS and the rest are whatever
// their CMS emits. A shape we do not recognise returns [] rather than
// throwing — one publisher changing platform must not end the night's run.
//
// Everything here is share-preview metadata. ⚠️ `content:encoded` — the full
// article body, which WordPress puts in every feed — is DELIBERATELY NOT READ.
// We index what a publisher offers for sharing; the body is theirs.
// ────────────────────────────────────────────────────────────────────

export interface FeedItem {
  url: string;
  title: string;
  /** The feed's own summary, HTML stripped and bounded. Never the body. */
  summary: string | null;
  /** The publisher's date, or null when the feed gave none we could read. */
  publishedOn: Date | null;
  author: string | null;
  /** From <enclosure>/<media:content>, when the feed carries one. */
  imageUrl: string | null;
  /**
   * RSS <source> — the paper that actually published it.
   *
   * ⚠️ ONLY GOOGLE NEWS FILLS THIS IN, and it is the reason the field exists:
   * a Google News headline is "Real headline - The Citizen", and stripping
   * that suffix by pattern would eat the dash out of a legitimate headline.
   * With the publisher's exact name in hand the suffix can be removed exactly
   * or left alone.
   */
  sourceName: string | null;
}

/** og:description length, and the same bound the standfirst is stored at. */
export const SUMMARY_MAX = 400;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // ⚠️ A feed whose only item is <item><title>7</title> must still read as a
  // string. Without this, fast-xml-parser hands back the number 7 and every
  // `.trim()` downstream throws.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const rss = pick(doc, 'rss');
  const channel = rss ? pick(rss, 'channel') : null;
  if (channel) return arrayOf(channel['item']).map(rssItem).filter(isItem);

  const feed = pick(doc, 'feed');
  if (feed) return arrayOf(feed['entry']).map(atomEntry).filter(isItem);

  // RSS 1.0 / RDF puts <item> at the top level beside <channel>.
  const rdf = pick(doc, 'rdf:RDF');
  if (rdf) return arrayOf(rdf['item']).map(rssItem).filter(isItem);

  return [];
}

/** The feed's own name for itself, used only in the poll's log line. */
export function parseFeedTitle(xml: string): string | null {
  try {
    const doc = parser.parse(xml) as Record<string, unknown>;
    const channel = pick(pick(doc, 'rss') ?? {}, 'channel');
    if (channel) return text(channel['title']);
    const feed = pick(doc, 'feed');
    if (feed) return text(feed['title']);
    return null;
  } catch {
    return null;
  }
}

// ─── item shapes ─────────────────────────────────────────────────────

function rssItem(raw: unknown): FeedItem | null {
  const it = asRecord(raw);
  if (!it) return null;
  const url = text(it['link']) ?? text(it['guid']);
  const title = text(it['title']);
  if (!url || !title || !/^https?:/i.test(url)) return null;
  return {
    url,
    title,
    summary: summarise(text(it['description'])),
    publishedOn: date(text(it['pubDate']) ?? text(it['dc:date'])),
    author: text(it['dc:creator']) ?? text(it['author']),
    imageUrl:
      attr(it['enclosure'], '@_url') ??
      attr(it['media:content'], '@_url') ??
      attr(it['media:thumbnail'], '@_url'),
    sourceName: text(it['source']),
  };
}

function atomEntry(raw: unknown): FeedItem | null {
  const it = asRecord(raw);
  if (!it) return null;
  // ⚠️ Atom's <link> is an ATTRIBUTE and there are usually several — the
  // alternate is the article, the others are comments and edit endpoints.
  const links = arrayOf(it['link']);
  const alternate =
    links.find((l) => attr(l, '@_rel') === 'alternate') ??
    links.find((l) => attr(l, '@_rel') === undefined) ??
    links[0];
  const url = attr(alternate, '@_href') ?? text(it['id']);
  const title = text(it['title']);
  if (!url || !title || !/^https?:/i.test(url)) return null;
  const author = asRecord(it['author']);
  return {
    url,
    title,
    summary: summarise(text(it['summary'])),
    publishedOn: date(text(it['published']) ?? text(it['updated'])),
    author: author ? text(author['name']) : null,
    imageUrl: attr(it['media:content'], '@_url') ?? attr(it['media:thumbnail'], '@_url'),
    sourceName: null,
  };
}

// ─── readers ─────────────────────────────────────────────────────────

function isItem(i: FeedItem | null): i is FeedItem {
  return i !== null;
}

function pick(o: unknown, key: string): Record<string, unknown> | null {
  const rec = asRecord(o);
  return rec ? asRecord(rec[key]) : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function arrayOf(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * A node's text. ⚠️ An element carrying BOTH attributes and text parses to an
 * object with a '#text' key rather than a string — `<title type="html">…` is
 * the everyday case in Atom — so a naive String() would store "[object
 * Object]" as a headline.
 */
function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  const rec = asRecord(v);
  if (rec && '#text' in rec) return text(rec['#text']);
  return null;
}

function attr(v: unknown, name: string): string | null {
  if (Array.isArray(v)) return attr(v[0], name);
  const rec = asRecord(v);
  if (!rec) return null;
  const a = rec[name];
  return typeof a === 'string' && a.trim() ? a.trim() : null;
}

function date(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A feed summary, made safe to print in a clipping: tags removed, entities
 * decoded, whitespace collapsed, bounded. WordPress puts a "Continue reading"
 * anchor and the post's own title in every excerpt, so the tags are not
 * cosmetic — leaving them in prints markup on the page.
 */
export function summarise(html: string | null): string | null {
  if (!html) return null;
  const plain = decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= SUMMARY_MAX) return plain;
  // Cut at a word so a clipping never ends mid-syllable.
  const cut = plain.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > SUMMARY_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/**
 * ⚠️ TWICE-ENCODED IS THE NORM. WordPress writes `&#8217;` into the RSS
 * description, and the description is itself XML-escaped, so what reaches
 * here after the XML parser is `&amp;#8217;` in some feeds and `&#8217;` in
 * others. Decoding once leaves an apostrophe printed as digits on the page,
 * so this runs twice — and no further, since a third pass could turn a
 * literal "&amp;" the publisher meant into "&".
 */
export function decodeEntities(s: string): string {
  const once = (t: string) =>
    t
      .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
        String.fromCodePoint(parseInt(h, 16)),
      )
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
  return once(once(s));
}
