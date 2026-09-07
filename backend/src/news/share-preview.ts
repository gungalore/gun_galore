import { decodeEntities, summarise } from './feed-parse';

// ────────────────────────────────────────────────────────────────────
// THE SHARE PREVIEW — WHAT A PUBLISHER PUBLISHES TO BE SHARED.
//
// Operator, 2026-09-07: "just the picture and headline and subscript that
// outline the article … it must look authentic". That is precisely the
// Open Graph card every news site emits for Facebook and WhatsApp, so the
// clipping is built from the publisher's own og: tags — never scraped body
// text, never a paraphrase.
//
// ⚠️ WE READ THE HEAD AND STOP. `readHead` streams the page and cuts at
// `</head>` or 512 KB, whichever comes first. Two reasons, and the second is
// the important one: an article page is 1–3 MB of ad script we have no use
// for, AND stopping at </head> means the article body is never in this
// process's memory at all. That is a design promise, not an optimisation.
// ────────────────────────────────────────────────────────────────────

export interface SharePreview {
  title: string | null;
  description: string | null;
  image: string | null;
  publishedTime: Date | null;
  author: string | null;
}

/** 512 KB. Comfortably past every <head> we measured; far short of a page. */
export const HEAD_BYTE_CAP = 512 * 1024;

/**
 * Read a page's head.
 *
 * ⚠️ RETURNS WHAT IT HAS WHEN THE CAP IS HIT WITHOUT SEEING `</head>` — some
 * CMSs inline a stylesheet and push the closing tag past half a megabyte, and
 * the og: tags are near the TOP of the head in every one of them. Truncated
 * markup parses fine here: the extractor is a set of regexes over meta tags,
 * not a document parser that needs a well-formed tree.
 */
export async function readHead(
  res: Response,
  cap = HEAD_BYTE_CAP,
): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let html = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      const end = html.indexOf('</head');
      if (end >= 0) return html.slice(0, end);
      if (bytes >= cap) return html;
    }
  } finally {
    // ⚠️ CANCEL, ALWAYS. Returning early from a fetch body without cancelling
    // leaks the socket, and this runs against ~74 hosts a night.
    void reader.cancel().catch(() => undefined);
  }
  const end = html.indexOf('</head');
  return end >= 0 ? html.slice(0, end) : html;
}

/**
 * The og: card from a page's head.
 *
 * ⚠️ EVERY FIELD MAY BE NULL AND THAT IS A NORMAL ANSWER, not a failure. Some
 * of the registry's titles emit no og tags at all; the poll falls back to the
 * feed's own title, description and date, which is why enrichment can never
 * make an article worse than the feed made it.
 */
export function parseSharePreview(html: string): SharePreview {
  const title =
    meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? titleTag(html);
  const description =
    meta(html, 'og:description') ??
    meta(html, 'twitter:description') ??
    meta(html, 'description');
  const image =
    meta(html, 'og:image:secure_url') ??
    meta(html, 'og:image') ??
    meta(html, 'twitter:image') ??
    meta(html, 'twitter:image:src');
  const published =
    meta(html, 'article:published_time') ??
    meta(html, 'og:article:published_time') ??
    meta(html, 'datePublished') ??
    meta(html, 'parsely-pub-date') ??
    meta(html, 'date');
  // ⚠️ THE FIRST NON-URL CANDIDATE WINS, not simply the first candidate.
  // `article:author` is a PROFILE URL as often as a name, and a page that
  // fills it with a URL almost always also carries the writer's name in a
  // plain `author` meta — so stopping at the first tag that EXISTS would
  // print a byline of "https://…", or drop the byline that was there.
  const author = [
    meta(html, 'article:author'),
    meta(html, 'author'),
    meta(html, 'parsely-author'),
    meta(html, 'twitter:creator'),
  ].find((a): a is string => !!a && !/^https?:/i.test(a));

  const when = published ? new Date(published) : null;
  return {
    title: title ? clean(title) : null,
    description: summarise(description),
    // An og:image is occasionally a protocol-relative or relative URL.
    image: image && /^(https?:)?\/\//i.test(image) ? absolute(image) : null,
    publishedTime: when && !Number.isNaN(when.getTime()) ? when : null,
    author: author ? clean(author).slice(0, 120) : null,
  };
}

/**
 * ⚠️ ATTRIBUTE ORDER IS NOT FIXED. `<meta property="og:title" content="…">`
 * and `<meta content="…" property="og:title">` are both everywhere in the
 * wild, and a regex that only handles the first silently returns nothing for
 * a whole publisher. Both orders are tried, and `property` and `name` both
 * count — Open Graph specifies `property`, most CMSs emit `name` anyway.
 */
function meta(html: string, key: string): string | null {
  const k = escapeRe(key);
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${k}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name|itemprop)\\s*=\\s*["']${k}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const v = m?.[1]?.trim();
    if (v) return decodeEntities(v);
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const v = m?.[1]?.trim();
  return v ? decodeEntities(v) : null;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function absolute(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
