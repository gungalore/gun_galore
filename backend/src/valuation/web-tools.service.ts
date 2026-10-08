import { Injectable, Logger } from '@nestjs/common';
import { LlmTool } from '../common/llm/llm.types';

export interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
}

/**
 * The backend-executed research tools. The model asks; we run them and hand
 * back results, so search can never be skipped or switched off by the member.
 *
 * `search` needs a search backend. When VALUATION_SEARCH_URL is unset the
 * search returns no hits and the valuation honestly reports missing data
 * rather than inventing prices. `openPage` needs no key: it fetches and
 * reduces a page to text.
 */
@Injectable()
export class WebToolsService {
  private readonly logger = new Logger(WebToolsService.name);

  tools(): LlmTool[] {
    return [
      {
        name: 'search_south_africa',
        description:
          'Search South African listing sites (classifieds, auction sites, dealer and retailer stores) for a query. Returns candidate URLs with titles. Use only South African sources.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'the search query' },
          },
        },
      },
      {
        name: 'open_page',
        description:
          'Open a URL and return its visible text so you can read the price, model, condition and date. Use this before citing any price.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'the page to open' },
          },
        },
      },
    ];
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'search_south_africa') {
      return this.searchJson(String(input.query ?? ''));
    }
    if (name === 'open_page') {
      return this.openPageJson(String(input.url ?? ''));
    }
    return JSON.stringify({ error: `unknown tool ${name}` });
  }

  async search(query: string): Promise<SearchHit[]> {
    const endpoint = process.env.VALUATION_SEARCH_URL;
    if (!endpoint || !query.trim()) return [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.VALUATION_SEARCH_KEY
            ? { Authorization: `Bearer ${process.env.VALUATION_SEARCH_KEY}` }
            : {}),
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: SearchHit[] };
      return Array.isArray(data.results) ? data.results.slice(0, 10) : [];
    } catch (e) {
      this.logger.warn(`search failed: ${(e as Error).message}`);
      return [];
    }
  }

  async openPage(url: string): Promise<PageContent | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AllOutdoorValuationBot/1.0 (+https://alloutdoor.co.za)' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return { url, title: '', text: '' };
      }
      const html = await res.text();
      return {
        url,
        title: extractTitle(html),
        text: extractText(html).slice(0, 6000),
      };
    } catch (e) {
      this.logger.warn(`open_page failed for ${url}: ${(e as Error).message}`);
      return null;
    }
  }

  private async searchJson(query: string): Promise<string> {
    const hits = await this.search(query);
    return JSON.stringify({ query, results: hits });
  }

  private async openPageJson(url: string): Promise<string> {
    const page = await this.openPage(url);
    if (!page) return JSON.stringify({ url, error: 'could not open page' });
    return JSON.stringify(page);
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().slice(0, 200) : '';
}

function extractText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
