// Small shared HTTP helper for the external source adapters. It enforces a
// timeout, a browser-ish UA, and (importantly) rejects a 200 that is not JSON,
// because several SA sites return an SPA shell with HTTP 200 on any path.

export interface JsonResult<T> {
  ok: boolean;
  data?: T;
}

export async function getJson<T>(url: string, timeoutMs = 10_000): Promise<JsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AllOutdoorValuationBot/1.0 (+https://alloutdoor.co.za)',
        Accept: 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Reject a promise that does not settle within `ms` (a slow source is cut, not awaited). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/** Fetch HTML as text, with the same UA + timeout discipline as getJson. */
export async function getHtml(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AllOutdoorValuationBot/1.0 (+https://alloutdoor.co.za)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse an HTML document to visible-ish text (drops script/style/tags). */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch any text response (HTML, XML, plain) with the shared UA + timeout. */
export async function getText(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        'Accept-Language': 'en-ZA,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
