import { parseFetchPage, parseMcpBody } from './scrapewise-client';

describe('parseMcpBody', () => {
  it('parses an SSE stream of data lines', () => {
    const sse = 'event: message\ndata: {"result":{"ok":1}}\n\n';
    expect(parseMcpBody(sse, 'text/event-stream')).toEqual([{ result: { ok: 1 } }]);
  });
  it('parses a plain JSON body', () => {
    expect(parseMcpBody('{"result":{"ok":2}}', 'application/json')).toEqual([{ result: { ok: 2 } }]);
  });
  it('returns [] for an unparseable body', () => {
    expect(parseMcpBody('not json', 'text/plain')).toEqual([]);
  });
});

describe('parseFetchPage', () => {
  it('unwraps the HTTP status line and the scraped-content envelope', () => {
    const raw = 'HTTP 200\n{"status":"DONE","content":{"type":"scraped","content":"Sako AV R8,009.00"}}';
    const result = { content: [{ type: 'text', text: raw }] };
    expect(parseFetchPage(result)).toBe('Sako AV R8,009.00');
  });
  it('returns null on a missing envelope or empty content', () => {
    expect(parseFetchPage(undefined)).toBeNull();
    expect(parseFetchPage({ content: [{ text: 'no newline here' }] })).toBeNull();
    expect(parseFetchPage({ content: [{ text: 'HTTP 200\n{"content":{"content":""}}' }] })).toBeNull();
  });
});
