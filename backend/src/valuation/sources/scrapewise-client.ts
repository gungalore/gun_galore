import { Injectable, Logger } from '@nestjs/common';

const MCP_URL = 'https://mcp.scrapewise.ai/mcp';
/** MCP sessions expire after 15 min; refresh a little earlier. */
const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Minimal MCP client for the Scrapewise gateway. Scrapewise mints only
 * LLM_READ / LLM_FULL keys, which are MCP-surface keys (USER keys are rejected),
 * so this speaks the Model Context Protocol over Streamable HTTP rather than the
 * REST API.
 *
 * The one tool we use is `fetch_page`: it renders a public page through a real
 * browser (so JS/SPA and Cloudflare-fronted SA shops work where a plain fetch
 * cannot) and returns its readable text or HTML. Billing is per page delivered
 * (~5 credits ≈ €0.00075 a rendered page), and a page fetched moments ago is
 * free, so callers must cache. Everything here is fail-soft: any failure returns
 * null so a valuation never breaks on a scraping hiccup.
 */
@Injectable()
export class ScrapewiseClient {
  private readonly logger = new Logger(ScrapewiseClient.name);
  private sessionId: string | null = null;
  private sessionAt = 0;
  private rpcId = 1;

  isConfigured(): boolean {
    return Boolean(process.env.SCRAPEWISE_API_KEY);
  }

  /** Render one public page and return its HTML (or readable text), else null. */
  async fetchPage(url: string, format: 'html' | 'text' = 'html', timeoutMs = 45_000): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const result = await this.toolCall('fetch_page', { body: { url, format } }, timeoutMs);
      return parseFetchPage(result);
    } catch (e) {
      this.logger.warn(`scrapewise fetch_page ${url} failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async toolCall(name: string, args: unknown, timeoutMs: number): Promise<unknown> {
    await this.ensureSession(timeoutMs);
    const out = await this.post(
      { jsonrpc: '2.0', id: this.rpcId++, method: 'tools/call', params: { name, arguments: args } },
      timeoutMs,
    );
    const msg = out.find((m) => m && m.result);
    return msg?.result;
  }

  private async ensureSession(timeoutMs: number): Promise<void> {
    if (this.sessionId && Date.now() - this.sessionAt < SESSION_TTL_MS) return;
    const out = await this.post(
      {
        jsonrpc: '2.0',
        id: this.rpcId++,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'alloutdoor-valuation', version: '1.0' } },
      },
      timeoutMs,
    );
    if (!this.sessionId) throw new Error('scrapewise returned no session id');
    this.sessionAt = Date.now();
    // The MCP handshake requires this notification before any tool call.
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs).catch(() => undefined);
    void out;
  }

  private async post(body: unknown, timeoutMs: number): Promise<Array<Record<string, any>>> {
    const key = process.env.SCRAPEWISE_API_KEY;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${key}`,
      };
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseMcpBody(await res.text(), res.headers.get('content-type') ?? '');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse a JSON body or an SSE stream of `data:` lines into JSON-RPC messages. */
export function parseMcpBody(text: string, contentType: string): Array<Record<string, any>> {
  if (contentType.includes('text/event-stream') || text.trimStart().startsWith('event:')) {
    return text
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim());
        } catch {
          return {};
        }
      });
  }
  try {
    return [JSON.parse(text)];
  } catch {
    return [];
  }
}

/**
 * The `fetch_page` tool returns `{ content:[{ type:'text', text }] }` where
 * `text` is `"HTTP <code>\n{ ...json... }"`. Unwrap to the scraped page body.
 * Pure, so it is unit-tested on a fixture.
 */
export function parseFetchPage(result: unknown): string | null {
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const raw = content.map((c) => c?.text ?? '').join('\n');
  const nl = raw.indexOf('\n');
  if (nl < 0) return null;
  try {
    const json = JSON.parse(raw.slice(nl + 1)) as { content?: { content?: unknown } };
    const page = json?.content?.content;
    return typeof page === 'string' && page.length > 0 ? page : null;
  } catch {
    return null;
  }
}
