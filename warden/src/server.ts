// warden/src/server.ts
//
// THE DAEMON'S FRONT DOOR. Transport, auth, and routing — no logic. Every
// route is one call into WardenCore, and every one of them is proxied by the
// Nest backend:
//
//   GET  /chat                     ≤ 8s  on the caller's side
//   POST /chat                     ≤ 25s
//   GET  /gates                    ≤ 8s   (the Site board's four vital tiles)
//   GET  /audit                    ≤ 8s   (what this daemon has actually run)
//   GET  /proposals/:id            ≤ 8s   (the backend's own pre-approve read)
//   POST /proposals/:id/approve    ≤ 25s
//   POST /proposals/:id/decline    ≤ 25s
//   POST /sweep                    ≤ 25s  (answers early rather than hanging)
//   POST /pause                    ≤ 25s
//   POST /resume                   ≤ 25s
//
// 🚨 THE COMMENT THAT USED TO BE HERE SAID "GET /gates IS NOT ONE OF THEM"
// AND THAT "NOTHING IN THE APP DEPENDS ON IT". IT WAS STALE AND DANGEROUS.
// WardenService.checkBoard() calls GET /gates and DeskController's
// GET /admin/desk/site/board renders the Site page's vital tiles from it;
// anyone trusting that line while rearranging this route table would have
// taken the Site board down. What is NOT proxied to this daemon is the Desk's
// own /admin/warden/gates — a completely different fact (CONFIG gates read
// inside the Nest process), one word apart in the UI.
//
// ⚠️ POST /sweep AND POST /pause ARE WRITES WITH NO BODY-SHAPED PAYLOAD, so
// the only thing they need off the caller is who is asking. operatorId is
// still REQUIRED on both: an audit trail that cannot name who stopped the
// watchdog is not an audit trail.
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
  /** ⚠️ PARSED HERE AND PASSED DOWN, because safePath() strips the query
   *  string before anything logs it — a route that re-derived it from req.url
   *  would be reading a URL the log deliberately never shows. */
  query: URLSearchParams;
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

  const ctx: Ctx = {
    method,
    pathname: url.pathname.replace(/\/+$/, '') || '/',
    query: url.searchParams,
    body,
  };

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

  // ⚠️ PROXIED, AND THE SITE BOARD DEPENDS ON IT — see the header.
  if (ctx.pathname === '/gates') {
    if (ctx.method !== 'GET') return methodNotAllowed(ctx);
    return { status: 200, payload: core.gates() };
  }

  /**
   * The audit trail. `?proposalId=` narrows to one run's records.
   *
   * ⚠️ THE FILTER IS CHARSET-CHECKED LIKE A PATH SEGMENT, NOT TRUSTED
   * BECAUSE IT IS "ONLY A QUERY STRING". It is compared against stored
   * proposal ids, and an id outside WARDEN_ID_RE matches nothing that could
   * ever have been stored — so it is dropped rather than passed through,
   * exactly as :id is on the proposal routes.
   */
  if (ctx.pathname === '/audit') {
    if (ctx.method !== 'GET') return methodNotAllowed(ctx);
    const raw = ctx.query.get('proposalId');
    if (raw !== null && !WARDEN_ID_RE.test(raw)) {
      return { status: 400, payload: { error: 'proposalId is not a proposal id' } };
    }
    const limitRaw = ctx.query.get('limit');
    return {
      status: 200,
      payload: core.audit({
        proposalId: raw ?? undefined,
        // An unparseable limit is left undefined for the core to default,
        // never coerced to 0 — Number('') is 0, and a limit of zero is an
        // empty audit trail that looks exactly like a daemon that has never
        // run anything.
        limit: limitRaw !== null && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined,
      }),
    };
  }

  /**
   * Measure everything now, cadence ignored.
   *
   * ⚠️ 200 WITH `finished: false` IS A SUCCESS, NOT A TIMEOUT. The sweep was
   * started and is still running; the core answered early so this request
   * cannot outlive nginx. A 503 here would tell the operator nothing
   * happened, when in fact the box is being measured as they read it.
   */
  if (ctx.pathname === '/sweep') {
    if (ctx.method !== 'POST') return methodNotAllowed(ctx);
    const parsed = readOperatorBody(ctx.body);
    if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
    return { status: 200, payload: await core.sweepNow() };
  }

  if (ctx.pathname === '/pause') {
    if (ctx.method !== 'POST') return methodNotAllowed(ctx);
    const parsed = readPauseBody(ctx.body);
    if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
    const result = await core.pause({ minutes: parsed.minutes, operatorId: parsed.operatorId, reason: parsed.reason });
    // The pause AS IT NOW STANDS goes back with the messages, so the caller
    // renders the real expiry rather than re-deriving one from the minutes it
    // asked for — the core clamps that, and a client that computed its own
    // would draw an expiry the daemon does not hold.
    return fromCore(result, { paused: core.pausedNow() });
  }

  if (ctx.pathname === '/resume') {
    if (ctx.method !== 'POST') return methodNotAllowed(ctx);
    const parsed = readOperatorBody(ctx.body);
    if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
    return fromCore(await core.resume(parsed.operatorId), { paused: null });
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
function fromCore(result: { ok: true; messages: unknown } | CoreFailure, extra: Record<string, unknown> = {}): Answer {
  if (result.ok) return { status: 200, payload: { messages: result.messages, ...extra } };
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

/**
 * The one thing a sweep or a resume needs off the caller: who is asking.
 *
 * ⚠️ REQUIRED, NOT OPTIONAL, ON BOTH. Forcing a sweep and resuming a paused
 * watchdog both change what the daemon does on a production box, and an
 * operational record that says "somebody resumed Warden" is not a record. The
 * backend fills it from the admin JWT's `sub`, so there is no caller for whom
 * this is a burden.
 */
function readOperatorBody(body: unknown): { ok: true; operatorId: string } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'expected a JSON object' };
  const operatorId = str(body.operatorId)?.trim();
  if (!operatorId) return { ok: false, error: 'operatorId is required' };
  return { ok: true, operatorId: operatorId.slice(0, 200) };
}

/**
 * ⚠️ AN ABSENT `minutes` IS A DEFAULT, A PRESENT-BUT-UNUSABLE ONE IS A 400.
 * The two are different mistakes: a client that sent nothing gets the core's
 * default hour, while a client that sent `"soon"` or `0` or `-5` has a bug
 * and must hear about it. Silently rounding either of the last two up to a
 * minimum would be a pause the operator did not ask for on a daemon they
 * believe they have stopped; silently treating them as zero would be a pause
 * that has expired before the response is written, which looks exactly like
 * the button not working.
 */
function readPauseBody(
  body: unknown,
): { ok: true; operatorId: string; minutes?: number; reason: string | null } | { ok: false; error: string } {
  const who = readOperatorBody(body);
  if (!who.ok) return who;
  const record = body as Record<string, unknown>;

  let minutes: number | undefined;
  if (record.minutes !== undefined && record.minutes !== null) {
    const n = Number(record.minutes);
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'minutes must be a positive number' };
    minutes = n;
  }

  const reason = str(record.reason)?.trim();
  return { ok: true, operatorId: who.operatorId, minutes, reason: reason ? reason.slice(0, 500) : null };
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
