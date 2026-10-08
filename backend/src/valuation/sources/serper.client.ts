import { Injectable, Logger } from '@nestjs/common';

export interface SerperResult {
  url: string;
  title: string;
  snippet?: string;
  date?: string;
  /** ZAR rands, integer, when a price could be parsed (shopping results). */
  priceZar?: number;
  sourceSite?: string;
}

const SERPER_BASE = 'https://google.serper.dev';

/**
 * Serper (google.serper.dev) search client for the valuation engine.
 *
 * Discovery only: it never touches photos. Reads SERPER_API_KEY (never logged)
 * and SERPER_GL (default `za` so results are South African). Two endpoints are
 * used: /search for listing discovery and /shopping for new-price anchors.
 */
@Injectable()
export class SerperClient {
  private readonly logger = new Logger(SerperClient.name);

  isConfigured(): boolean {
    return Boolean(process.env.SERPER_API_KEY);
  }

  private gl(): string {
    return process.env.SERPER_GL ?? 'za';
  }

  async search(query: string, num = 10): Promise<SerperResult[]> {
    const data = await this.post('/search', { q: query, num });
    const organic = (data?.organic ?? []) as Array<Record<string, unknown>>;
    return organic
      .map((o) => ({
        url: String(o.link ?? ''),
        title: String(o.title ?? ''),
        snippet: o.snippet ? String(o.snippet) : undefined,
        date: o.date ? String(o.date) : undefined,
      }))
      .filter((r) => r.url.startsWith('http'));
  }

  async shopping(query: string, num = 10): Promise<SerperResult[]> {
    const data = await this.post('/shopping', { q: query, num });
    const items = (data?.shopping ?? []) as Array<Record<string, unknown>>;
    return items
      .map((o) => ({
        url: String(o.link ?? ''),
        title: String(o.title ?? ''),
        sourceSite: o.source ? String(o.source) : undefined,
        priceZar: parseZar(String(o.price ?? '')),
      }))
      .filter((r) => r.url.startsWith('http') && r.priceZar !== undefined);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.isConfigured()) throw new Error('Serper not configured');
    const payload = JSON.stringify({ gl: this.gl(), hl: 'en', ...body });
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${SERPER_BASE}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': process.env.SERPER_API_KEY as string,
          },
          body: payload,
          signal: controller.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`serper ${res.status}`);
          await sleep(600 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          // Do not include the response body: it can echo the request.
          throw new Error(`serper ${res.status}`);
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (err) {
        lastErr = err as Error;
        if ((err as Error).name === 'AbortError') lastErr = new Error('serper timeout');
      } finally {
        clearTimeout(timeout);
      }
    }
    // Log the failure without the query text or the key.
    this.logger.warn(`serper ${path} failed: ${lastErr?.message ?? 'unknown'}`);
    return {};
  }
}

function parseZar(price: string): number | undefined {
  const m = price.match(/R\s*([\d\s.,]+)/i);
  if (!m) return undefined;
  const cleaned = m[1].replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
