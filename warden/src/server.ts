// warden/src/server.ts
//
// THE DAEMON'S FRONT DOOR. Transport, auth, and routing — no logic. Every
// route is one call into WardenCore, and the five that matter are exactly the
// five the Nest backend proxies:
//
//   GET  /chat                     ≤ 8s  on the caller's side
//   POST /chat                     ≤ 25s
//   GET  /proposals/:id            ≤ 8s   (the backend's own pre-approve read)
//   POST /proposals/:id/approve    ≤ 25s
//   POST /proposals/:id/decline    ≤ 25s
//
// ⚠️ GET /gates IS NOT ONE OF THEM. The Desk's own /admin/warden/gates is
// answered inside the Nest process from DeskSiteService and never calls out —
// warden.service.ts's gates() makes no network call at all. The route below
// exists for a curl on the box and a post-deploy smoke test; nothing in the
// app depends on it.
//
// ⚠️ NOTHING HERE IS PUBLIC. It binds to loopback by default and every route,
// without exception, requires the bearer token. There is no unauthenticated
// liveness ping: a route that answers without the token is a route that tells
// an unauthenticated caller this daemon is here and what it is.
//
// ON ERROR BODIES: the backend logs a non-2xx body server-side (truncated) and
// NEVER shows it to the operator, mapping 404 and 409 to their own exceptions
// and everything else to a generic 503. So the statuses below are load-bearing
// and the prose in them is for the box's log.

import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WARDEN_ID_RE } from './types.js';
import type { CoreFailure, WardenCore } from './state/index.js';

/** A chat message is capped at 4000 chars by the backend's DTO long before it
 *  gets here; anything approaching this is not a message. */
const MAX_BODY_BYTES = 64 * 1024;

/** Last-resort ceiling. Every handler is already bounded — GET is memory,
 *  POST /chat has its own budget — so this only fires if one is not, and it
 *  fires well inside nginx's 60s and Cloudflare's 100s. */
const DEFAULT_REQUEST_BUDGET_MS = 45_000;

export interface ServerOptions {
  core: WardenCore;
  token: string;
  requestBudgetMs?: number;
  /** Where a request line goes. Never the Authorization header, never a body. */
  log?: (line: string) => void;
}

interface Ctx {
  method: string;
  pathname: string;
  body: unknown;
}

export function createServer(opts: ServerOptions): http.Server {
  const budget = opts.requestBudgetMs ?? DEFAULT_REQUEST_BUDGET_MS;
  const log = opts.log ?? (() => undefined);
  const expected = digest(opts.token);

  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    void handle(req, res, opts.core, expected, budget)
      .catch((err: unknown) => {
        // A throw that reached here is a bug in the routing, not a fault on
        // the box. Answer, log it, and stay up: a daemon that dies on one bad
        // request takes the whole board with it.
        log(`error ${req.method} ${safePath(req.url)} ${errorText(err)}`);
        send(res, 500, { error: 'warden failed to handle that request' });
      })
      .finally(() => {
        log(`${req.method} ${safePath(req.url)} ${res.statusCode} ${Date.now() - startedAt}ms`);
      });
  });

  // Node's own guards, so a stalled or oversized connection cannot pin a
  // socket open indefinitely behind the handler-level budget.
  server.headersTimeout = 10_000;
  server.requestTimeout = budget + 5_000;
  server.keepAliveTimeout = 30_000;
  return server;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  core: WardenCore,
  expected: Buffer,
  budgetMs: number,
): Promise<void> {
  // ⚠️ AUTH FIRST, BEFORE THE BODY IS EVEN READ. An unauthenticated caller
  // must not be able to make this process allocate 64KB per connection.
  if (!authorised(req, expected)) {
    send(res, 401, { error: 'unauthorised' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://warden.local');
  const method = req.method ?? 'GET';

  let body: unknown = undefined;
  if (method === 'POST') {
    const read = await readJsonBody(req);
    if (!read.ok) {
      send(res, read.status, { error: read.error });
      return;
    }
    body = read.value;
  }

  const ctx: Ctx = { method, pathname: url.pathname.replace(/\/+$/, '') || '/', body };

  const answered = await Promise.race([
    route(ctx, core).then((r) => ({ timedOut: false as const, r })),
    sleep(budgetMs).then(() => ({ timedOut: true as const, r: null })),
  ]);

  if (answered.timedOut || !answered.r) {
    send(res, 503, { error: `warden did not finish that request within ${budgetMs}ms` });
    return;
  }
  send(res, answered.r.status, answered.r.payload);
}

// ── routing ─────────────────────────────────────────────────────────────

interface Answer {
  status: number;
  payload: unknown;
}

async function route(ctx: Ctx, core: WardenCore): Promise<Answer> {
  if (ctx.pathname === '/chat') {
    if (ctx.method === 'GET') return { status: 200, payload: core.chat() };
    if (ctx.method === 'POST') {
      const parsed = readChatBody(ctx.body);
      if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
      return fromCore(await core.say(parsed.message, parsed.operatorId));
    }
    return methodNotAllowed(ctx);
  }

  // Not proxied — see the header. Local visibility only.
  if (ctx.pathname === '/gates') {
    if (ctx.method !== 'GET') return methodNotAllowed(ctx);
    return { status: 200, payload: core.gates() };
  }

  const proposal = /^\/proposals\/([^/]+)(?:\/(approve|decline))?$/.exec(ctx.pathname);
  if (proposal) {
    const id = decodeURIComponent(proposal[1]!);
    const action = proposal[2];

    // ⚠️ The id lands nowhere but a store lookup here, but it arrived in a URL
    // path and the same charset guards it on the backend's side. Anything
    // outside it is not "not found" for an interesting reason — it is not a
    // proposal id at all, and saying 404 keeps the two indistinguishable to a
    // caller probing the route.
    if (!WARDEN_ID_RE.test(id)) return { status: 404, payload: { error: 'no such proposal' } };

    if (!action) {
      if (ctx.method !== 'GET') return methodNotAllowed(ctx);
      const found = core.proposal(id);
      if (!found) return { status: 404, payload: { error: 'no such proposal' } };
      return { status: 200, payload: found };
    }

    if (ctx.method !== 'POST') return methodNotAllowed(ctx);

    if (action === 'approve') {
      const parsed = readApproveBody(ctx.body);
      if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
      return fromCore(await core.approve(id, parsed.operatorId, parsed.expectedCommand));
    }

    const parsed = readDeclineBody(ctx.body);
    if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
    return fromCore(await core.decline(id, parsed.operatorId, parsed.reason));
  }

  return { status: 404, payload: { error: 'no such route' } };
}

function methodNotAllowed(ctx: Ctx): Answer {
  return { status: 405, payload: { error: `${ctx.method} is not allowed on ${ctx.pathname}` } };
}

/** The core's refusals already carry the status the backend needs — 404 and
 *  409 are the two it maps to their own exceptions, and everything else it
 *  turns into a generic 503 with the body discarded from the operator's view. */
function fromCore(result: { ok: true; messages: unknown } | CoreFailure): Answer {
  if (result.ok) return { status: 200, payload: { messages: result.messages } };
  return { status: result.status, payload: { error: result.reason } };
}

// ── auth ────────────────────────────────────────────────────────────────

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Compared as fixed-length digests so the comparison cannot leak the token's
 * length or its matching prefix through timing. An empty or malformed header
 * fails the same way a wrong token does — there is nothing to be learned from
 * which one it was.
 */
function authorised(req: http.IncomingMessage, expected: Buffer): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(digest(match[1]!), expected);
}

// ── bodies ──────────────────────────────────────────────────────────────

type BodyRead = { ok: true; value: unknown } | { ok: false; status: number; error: string };

async function readJsonBody(req: http.IncomingMessage): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        // Stop reading. Anything this big is not a chat message and there is
        // no reason to buffer the rest of it to find that out.
        req.destroy();
        return { ok: false, status: 413, error: 'request body too large' };
      }
      chunks.push(buf);
    }
  } catch (err) {
    return { ok: false, status: 400, error: `could not read the request body: ${errorText(err)}` };
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'request body is not valid JSON' };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function readChatBody(body: unknown): { ok: true; message: string; operatorId: string } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'expected a JSON object' };
  const message = str(body.message)?.trim();
  const operatorId = str(body.operatorId)?.trim();
  if (!message) return { ok: false, error: 'message is required' };
  if (!operatorId) return { ok: false, error: 'operatorId is required' };
  return { ok: true, message: message.slice(0, 4_000), operatorId: operatorId.slice(0, 200) };
}

function readApproveBody(
  body: unknown,
): { ok: true; operatorId: string; expectedCommand: string } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'expected a JSON object' };
  const operatorId = str(body.operatorId)?.trim();
  // ⚠️ NOT TRIMMED. This is the string the compare-and-swap compares byte for
  // byte; trimming it here would quietly make two different commands equal,
  // which is exactly how a money-grade confirm gets defeated while still
  // appearing to work.
  const expectedCommand = str(body.expectedCommand);
  if (!operatorId) return { ok: false, error: 'operatorId is required' };
  if (expectedCommand === null || expectedCommand === '') return { ok: false, error: 'expectedCommand is required' };
  return { ok: true, operatorId: operatorId.slice(0, 200), expectedCommand };
}

function readDeclineBody(
  body: unknown,
): { ok: true; operatorId: string; reason?: string } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'expected a JSON object' };
  const operatorId = str(body.operatorId)?.trim();
  if (!operatorId) return { ok: false, error: 'operatorId is required' };
  // An absent key and an empty string are the SAME case: the backend drops an
  // empty reason from the JSON body entirely, so "no reason given" arrives as
  // a missing key and must never be stored as a blank standing instruction.
  const reason = str(body.reason)?.trim();
  return reason ? { ok: true, operatorId: operatorId.slice(0, 200), reason: reason.slice(0, 2_000) } : { ok: true, operatorId: operatorId.slice(0, 200) };
}

// ── plumbing ────────────────────────────────────────────────────────────

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload ?? {});
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Path only — a query string could carry something a caller put there, and a
 *  log line is a place secrets go to live forever. */
function safePath(url: string | undefined): string {
  if (!url) return '/';
  const q = url.indexOf('?');
  return (q === -1 ? url : url.slice(0, q)).slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
