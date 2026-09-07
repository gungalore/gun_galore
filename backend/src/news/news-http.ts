// ────────────────────────────────────────────────────────────────────
// EVERY REQUEST THIS FEATURE MAKES TO SOMEBODY ELSE'S SERVER.
//
// One file, because the rules are the same wherever they apply and they are
// easy to forget one at a time: a timeout, a byte cap, and a user agent that
// says what we are. A poll that reaches ~74 hosts a night is a well-behaved
// robot or it is a nuisance, and the difference is entirely in this file.
//
// ⚠️ NOTHING HERE THROWS PAST ITS CALLER'S ABILITY TO CARRY ON. A dead paper
// is one line in a log; it is never the end of the night's run.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ A REAL BROWSER STRING, ON PURPOSE. Several South African publishers sit
 * behind a WAF that answers a bot-shaped UA with a 403 — which is what
 * feeds.news24.com, IOL's cmlink feeds and People's Post did during the
 * registry survey. This is not evasion: we take the publisher's own share
 * card at the publisher's own rate, and the fetch is capped and slow.
 */
export const NEWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** A feed. 20 s and 5 MB — the largest in the registry is under 400 KB. */
export const FEED_TIMEOUT_MS = 20_000;
export const FEED_BYTE_CAP = 5 * 1024 * 1024;

/** An article page. We stop at </head>, so this is only the hard stop. */
export const PAGE_TIMEOUT_MS = 15_000;

/** A picture, fetched only when a pack is built. */
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_BYTE_CAP = 8 * 1024 * 1024;

export class NewsFetchError extends Error {}

/**
 * GET a URL and read at most `cap` bytes of text.
 *
 * ⚠️ THE CAP IS ENFORCED WHILE READING, not from Content-Length — a server
 * that lies about its length, or omits it, would otherwise stream into this
 * process until the box ran out of memory. `res.text()` cannot do this, which
 * is why the body is read by hand.
 */
export async function fetchTextCapped(
  url: string,
  opts: { timeoutMs?: number; cap?: number; accept?: string } = {},
): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? FEED_TIMEOUT_MS),
    headers: {
      'user-agent': NEWS_USER_AGENT,
      accept: opts.accept ?? 'application/rss+xml, application/xml, text/xml, */*',
      'accept-language': 'en-ZA,en;q=0.9',
    },
  });
  if (!res.ok) throw new NewsFetchError(`HTTP ${res.status}`);

  const cap = opts.cap ?? FEED_BYTE_CAP;
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= cap) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out;
}

/**
 * The response for an article page, for `readHead` to stream.
 *
 * ⚠️ A NON-HTML ANSWER IS REFUSED HERE rather than parsed and found empty —
 * a feed link pointing at a PDF or a podcast is common enough, and reading
 * half a megabyte of it to find no og: tags is a waste of somebody's bandwidth
 * as well as ours.
 */
export async function getArticlePage(url: string): Promise<Response> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    headers: {
      'user-agent': NEWS_USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-ZA,en;q=0.9',
    },
  });
  if (!res.ok) throw new NewsFetchError(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(type)) {
    void res.body?.cancel().catch(() => undefined);
    throw new NewsFetchError(`not html (${type || 'no content-type'})`);
  }
  return res;
}

/**
 * A clipping's picture.
 *
 * ⚠️ image/* ONLY, AND CAPPED WHILE READING. This URL comes from a third
 * party's og:image, so it is an attacker-influenced fetch in the general case:
 * the content-type check stops us handing an HTML error page to sharp, and the
 * byte cap stops a slow infinite stream. Redirects are followed but the final
 * URL must still be same-origin with the one we asked for — a redirect off the
 * publisher's own host is not a news photograph.
 */
export async function fetchImageBytes(
  url: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const asked = new URL(url);
    if (asked.protocol !== 'https:' && asked.protocol !== 'http:') return null;

    const res = await fetch(asked, {
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      headers: { 'user-agent': NEWS_USER_AGENT, accept: 'image/*' },
    });
    if (!res.ok) return null;

    const landed = new URL(res.url || url);
    if (landed.host !== asked.host) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(type)) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }

    const body = res.body;
    if (!body) return null;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > IMAGE_BYTE_CAP) return null;
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    if (!bytes) return null;
    return {
      base64: Buffer.concat(chunks).toString('base64'),
      mimeType: type.split(';')[0].trim().toLowerCase(),
    };
  } catch {
    return null;
  }
}
