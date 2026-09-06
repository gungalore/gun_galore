import { safeJson } from '../safe-json';

/**
 * THE BENCH — the client's API.
 *
 * Follows the motivation writer's client (lib/motivations-api.ts), for the
 * same two reasons:
 *
 *   A FRESH TOKEN PER REQUEST. The Bench is a long sitting — someone browses
 *   loads, opens a spec card, reads a drawing, then logs a load twenty minutes
 *   later. A token captured on mount is stale by then, so getToken() is called
 *   per request and never hoisted.
 *
 *   safeJson ON EVERY BODY. A raw res.json() throws on an empty 200, which is
 *   what DELETE /bench/log/:id returns. That crash surfaces to the member as a
 *   blank page over a request that actually succeeded.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type TokenGetter = () => Promise<string | null>;

export class BenchApiError extends Error {
  /**
   * The response body, verbatim.
   *
   * 🚨 FOR THE CONSOLE, NEVER FOR THE SCREEN. It used to BE the message, so
   * every `e.message` on this module — the log list's row error, the log
   * sheet's inline line, the toast — printed whatever answered: an nginx error
   * page on a 502, a Clerk JSON blob on a 401. It is also the one string here
   * nothing has vetted against the copy rules, and a gateway is free to say
   * "source" or "manual" on a surface where that vocabulary is forbidden.
   */
  body?: string;

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BenchApiError';
  }
}

/**
 * What a superseded read is aborted with.
 *
 * ⚠️ NOT AN ERROR THE MEMBER MAY EVER SEE. `AbortController.abort()` rejects
 * the fetch with a DOMException named AbortError, and the only thing that ever
 * aborts a Bench read is US, one keystroke ahead of ourselves — a second spec
 * card opened before the first answered. Toasting that would tell the member
 * their own tap failed.
 */
export function isAbort(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * What to PUT ON THE SCREEN when a bench call fails.
 *
 * 🚨 THE RESPONSE BODY IS NEVER IT. `call()` throws with the raw text of
 * whatever answered, and on this deployment that is an nginx error page on a
 * 502 and a Clerk JSON blob on a 401 — both of which were rendered verbatim
 * into the page, one of them several hundred bytes of HTML. It is also the one
 * string on this module nothing has vetted against the copy rules: a gateway
 * or a framework may say "source" or "manual" in an error and put it on a
 * surface where that vocabulary is forbidden.
 *
 * So the status decides the sentence and the body is dropped. Callers log the
 * original to the console, where a developer can read it and a member cannot.
 */
function copyForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Sign in again to see your bench.';
  if (status === 404) return 'That is no longer here.';
  if (status === 400 || status === 413) return 'That is more than one link can carry.';
  return 'The bench could not load. Try again.';
}

export function benchErrorCopy(e: unknown): string {
  return copyForStatus(e instanceof BenchApiError ? e.status : 0);
}

async function call<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/bench${path}`, {
    ...init,
    /**
     * 🚨 EVERY ANSWER ON THIS MODULE VARIES BY VIEWER — `/bench/loads` is
     * literally "what YOU can build" — and the browser's own HTTP cache keys
     * on the URL, not on the Authorization header. Two members on one machine
     * share `/api/bench/loads` exactly, so without this one of them is served
     * the other's shelf. CLAUDE.md's rule; the controller sets
     * `private, no-store` at the other end, and this is the half of the pair
     * the browser obeys before it ever asks.
     */
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    /**
     * 🚨 THE MESSAGE IS THE MEMBER'S SENTENCE; THE BODY IS ATTACHED BESIDE IT.
     * Several surfaces on this module render `e.message` inline — the log
     * list's row, the log sheet's error line — and none of them can be
     * expected to remember to launder it. Made safe HERE, at the one place an
     * error is created, they all are.
     */
    const err = new BenchApiError(copyForStatus(res.status), res.status);
    err.body = body;
    throw err;
  }
  // safeJson needs an explicit fallback; null is right here because the only
  // bodiless response on this API is DELETE /log/:id, whose caller ignores it.
  return (await safeJson<T | null>(res, null)) as T;
}

/**
 * A read that may be superseded.
 *
 * ⚠️ `RequestInit.signal` IS THE WHOLE MECHANISM — no new plumbing. `call()`
 * already spreads its init into fetch, so a signal handed in here reaches the
 * request; what this type does is stop each read inventing its own name for
 * it.
 */
export interface BenchReadOpts {
  signal?: AbortSignal;
}

/* ── Shapes, mirroring backend/src/bench/bench.types.ts ─────────────── */

export type CoalFlag = 'COAL_OVER_MAX' | 'COAL_NEAR_MAX' | 'COAL_RANGE';

export interface LoadRow {
  id: string;
  bulletMaker: string;
  bulletType: string;
  powder: string;
  startGr: number;
  startFps: number | null;
  maxGr: number;
  maxFps: number | null;
  coalMm: number | null;
  coalLoMm: number | null;
  coalHiMm: number | null;
  flags: CoalFlag[];
}

export interface WeightGroup {
  weightGr: number;
  rows: LoadRow[];
}

export interface CartridgeHead {
  key: string;
  name: string;
  maxLengthMm: number | null;
  pmaxBar: number | null;
  pmaxPsi: number | null;
  /** The thirteen C.I.P. figures the silhouette needs, or null when the sheet is incomplete. */
  thumb: Record<string, number | null> | null;
}

export interface LoadGroup {
  cartridge: CartridgeHead;
  weights: WeightGroup[];
}

/**
 * Why a search came back empty.
 *
 * ⚠️ AN EMPTY BENCH SCREEN IS INDISTINGUISHABLE FROM A BROKEN ONE WITHOUT
 * THIS. Results are an AND across powder, bullet and cartridge, so one
 * starving axis empties the page and the member cannot tell which. These are
 * the counts with each axis relaxed in turn: if dropping the bullets would
 * have found loads, the bullets are what is missing.
 *
 * Present only when count is 0 and the bench holds all three axes.
 */
export interface LoadsWhy {
  /** Loads for the cartridges and powders on the bench, ignoring its bullets. */
  ignoringBullets: number;
  /** Loads for the cartridges and bullets on the bench, ignoring its powders. */
  ignoringPowders: number;
  /** Loads for the powders and bullets on the bench, ignoring its cartridges. */
  ignoringCartridges: number;
}

export interface LoadsResponse {
  count: number;
  groups: LoadGroup[];
  why?: LoadsWhy;
  /**
   * The server stopped at its cap (600 rows) and there are more.
   *
   * ⚠️ PRESENT ONLY WHEN TRUE — BenchService spreads the key in rather than
   * always writing it — so read it as a boolean and never as `'truncated' in r`.
   * A cap the screen does not mention is a screen quietly lying about how much
   * a shelf can build, which is the one thing that makes a cap illegitimate.
   */
  truncated?: boolean;
}

export interface BenchPowder {
  id: string;
  name: string;
  maker: string | null;
  loadsForBench?: number;
}

/**
 * A bullet as the member's bench stores it.
 *
 * ⚠️ maker AND category ARE LEGACY DECORATION. Benches saved before the
 * weight model carry them, and they are kept so nothing of a member's is
 * thrown away — but nothing matches on them any more. A stored bullet is
 * identified by its weight and calibre; see bulletKey().
 */
export interface BenchBullet {
  weightGr: number;
  /** Inches. Absent on benches saved before calibres were recorded. */
  calibreIn?: number | null;
  maker?: string;
  category?: string;
  type?: string;
}

export interface BenchView {
  powders: BenchPowder[];
  bullets: BenchBullet[];
  cartridges: { key: string; name: string }[];
  units: string;
}

/**
 * One row of GET /bench/bullets — mirrors BenchService.BenchBulletOptionView.
 *
 * ⚠️ DECLARED HERE, NOT IN contract.ts, WHICH RE-EXPORTS IT. This is a wire
 * shape, and contract.ts's own header says data shapes come from this file and
 * are not redeclared there. Two declarations of one payload is how a field
 * added at one end quietly stops being read at the other.
 */
export interface BenchBulletOption {
  /**
   * 🚨 A WEIGHT IS NOT A BULLET, AND A BULLET IS NOT A BRAND. "150 gr"
   * names four different projectiles across calibres — .277 for .270 Win,
   * .308, .311 for .303 British, .323 for 8x57 — so the calibre is half
   * the identity. The MAKER is not part of it at all: a 150 gr .308 from
   * Hornady, Sierra or Barnes gives near enough the same pressures and
   * speeds, which is the whole point of the Bench.
   *
   * Inches; null only where no C.I.P. sheet gives a diameter.
   */
  calibreIn: number | null;
  weightGr: number;
  /**
   * How many consolidated loads use it.
   *
   * ⚠️ NEVER A COUNT OF WHAT THOSE LOADS WERE BUILT FROM. Operator ruling
   * 2026-09-02; the leak spec is the other half of this boundary.
   */
  loads: number;
}

/** One row of GET /bench/cartridges. `loads` reads exactly as above. */
export interface BenchCartridgeOption {
  key: string;
  name: string;
  loads: number;
}

export interface CartridgeSpec {
  cartridge: {
    key: string;
    name: string;
    slug: string;
    type: string | null;
    origin: string | null;
    year: number | null;
    caseLengthMm: number | null;
    maxLengthMm: number | null;
    pmaxPsi: number | null;
    pmaxBar: number | null;
  };
  dims: Record<string, number | string | null> | null;
  /**
   * ⚠️ THE SERVER'S NAMES, NOT COMFORTABLE ONES. BenchService.cartridge()
   * returns loadsForBench (buildable from THIS member's shelf) and loadCount
   * (every load for the cartridge). Calling the first "loadsOnBench" read
   * better and silently arrived as undefined — the spec card rendered a blank
   * where a figure belongs, and nothing on either side failed a type check.
   */
  loadsForBench: number;
  loadCount: number;
  // `stations` used to sit here as unknown[] and was read by nothing: the
  // calliper snap points are a pure function of dims, and LatheView computes
  // them itself. A field carried across the wire that no one reads is a
  // second copy waiting to disagree with the first.
  shellHolderGroup: { key: string; name: string }[];
  /**
   * How many more cartridges share this case head than the chips above.
   *
   * ⚠️ THE SERVER CAPS `shellHolderGroup` AT TWELVE and reports the remainder
   * here, so the card can print "+7 more" rather than silently claiming twelve
   * is all of them. Optional rather than required only so the existing spec
   * fixtures — which predate the field — still type-check; the server always
   * sends it.
   */
  shellHolderMore?: number;
}

/* ── The permalink ──────────────────────────────────────────────────── */

/**
 * What a share link carries: the finder's controls, plus a snapshot of the
 * shelf they were read against.
 *
 * 🚨 THE SNAPSHOT IS A DESCRIPTION, NEVER AN INSTRUCTION. Opening somebody's
 * link may narrow the READER's search — see offFromSnapshot in
 * components/bench/contract.ts — and may never write to the reader's own
 * bench. A link that could add six powders to a stranger's shelf is a link
 * nobody can safely open.
 */
export interface BenchSharePayload {
  filters: {
    cartridge?: string;
    weight?: string;
    tolerance?: number;
    off?: { powderIds: string[]; cartridgeKeys: string[]; bullets: string[] };
  };
  bench?: {
    powders: { id: string; name: string }[];
    bullets: { weightGr: number; calibreIn?: number | null }[];
    cartridges: { key: string; name: string }[];
  };
}

/**
 * ⚠️ THE SERVER WRAPS IT IN `payload`, AND WRAPS IT BACK. ShareBenchDto takes
 * `{ payload }` — a bare filter object is stripped to nothing by the global
 * `whitelist: true` and stored as `{}` — and readShare answers
 * `{ token, payload, expiresAt }`, not the payload alone. Both wrappers are
 * handled in the two calls below so no caller has to remember either.
 */
export interface BenchShare {
  token: string;
  url: string;
}

/**
 * ⚠️ FIELD NAMES ARE THE SERVERS, NOT COMFORTABLE ONES. The row is stored as
 * bulletLabel / powderName / caseLabel / shotAt; renaming them here to bullet /
 * powder / cases / firedOn reads better and silently sends undefined, because
 * nothing on either side would fail a type check.
 */
export interface LogEntry {
  id: string;
  cartridgeKey: string;
  /** Resolved server-side — a key is not a thing to show someone. */
  cartridgeName: string;
  bulletLabel: string;
  powderName: string;
  chargeGr: number;
  coalMm: number | null;
  primer: string | null;
  caseLabel: string | null;
  loadId: string | null;
  velocityMs: number | null;
  groupMm: number | null;
  notes: string | null;
  /** ISO date-time. */
  shotAt: string;
  createdAt: string;
  /**
   * What the server made of the entry: the COAL flags the results rows carry,
   * plus `ABOVE_MAX` / `BELOW_START` for the charge against the load it came
   * off.
   *
   * ⚠️ `string[]`, NOT A UNION, BECAUSE IT IS WIRE DATA. A flag the server
   * learns to send before this file learns to name it must still arrive; the
   * renderer maps the ones it knows and drops the rest rather than tripping a
   * cast. LOG_FLAG_LABELS in LogList.tsx is the mapping.
   */
  flags: string[];
  /**
   * The window the entry is judged against — the start and max charge of the
   * load it was logged from. Null where the entry carries no `loadId`, or
   * where that load has since gone.
   */
  startGr: number | null;
  maxGr: number | null;
}

/**
 * The three figures a member fills in AFTER the range.
 *
 * ⚠️ NULL IS A VALUE HERE, AND `undefined` IS ITS ABSENCE. Sending
 * `velocityMs: null` clears a figure; omitting the key leaves it alone. The
 * server keeps that distinction, so this shape must not collapse it.
 */
export interface LogResultsPatch {
  velocityMs?: number | null;
  groupMm?: number | null;
  notes?: string | null;
}

/* ── Calls ──────────────────────────────────────────────────────────── */

export interface LoadQuery {
  /**
   * Grains either side of a bench bullet's weight to search. Omitted means
   * the server's default of 5.
   *
   * 🚨 A SEARCH WIDTH, NEVER A CHARGE. It decides which loads the member is
   * SHOWN; every load that comes back is still quoted at ITS OWN bullet
   * weight with its own start and max charge. Nothing on this wire says a
   * charge for a 145 gr bullet may be used with a 155 gr one.
   */
  tolerance?: number;
  cartridge?: string;
  weight?: string;
  /** Bench entries the member has switched off for this search only. */
  off?: string[];
}

/**
 * The grain window onto a query string.
 *
 * 🚨 ZERO IS A CHOICE, NOT AN ABSENCE, AND `if (tolerance)` WOULD EAT IT.
 * The finder's narrowest setting is "Exact", which is a tolerance of 0 —
 * and an omitted tolerance falls back to the server's default of 5, so a
 * falsey check would leave the one member who deliberately asked for the
 * exact weight looking at a ± 5 gr answer with "Exact" lit in the toolbar.
 * The other three widths would work, which is what makes it hard to see.
 *
 * NaN is dropped rather than sent: `?tolerance=NaN` is a string the server
 * has to guess about, and its default is the right guess.
 *
 * 🚨 ONE SPELLING, BECAUSE THREE SURFACES SEND IT. The loads list, the powder
 * rows' counts and the spec card's "loads on your bench" are three answers
 * about ONE shelf, and the server resolves the window per request — so a
 * surface that serialises it differently, or not at all, prints a figure the
 * list beside it contradicts.
 */
function setTolerance(p: URLSearchParams, tolerance: number | undefined): void {
  if (tolerance !== undefined && Number.isFinite(tolerance)) {
    p.set('tolerance', String(tolerance));
  }
}

function query(q: LoadQuery): string {
  const p = new URLSearchParams();
  if (q.cartridge && q.cartridge !== 'all') p.set('cartridge', q.cartridge);
  if (q.weight && q.weight !== 'any') p.set('weight', q.weight);
  setTolerance(p, q.tolerance);
  if (q.off?.length) p.set('off', q.off.join(','));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * The shelf a bench-relative COUNT is counted against — everything that
 * narrows the loads list and therefore has to narrow the count beside it.
 *
 * 🚨 BOTH FIELDS ARE REQUIRED, AND THAT IS THE WHOLE GUARD. BenchController
 * .benchFor() reads `off` AND `tolerance` on every bench endpoint, so the
 * results, the powder chips' counts and the spec card's "loads on your bench"
 * agree only for a caller that sends both. Neither omission fails: the request
 * quietly answers for a DIFFERENT shelf. `off` omitted answers for the full
 * bench, and the spec card reads "12 loads on your bench" over a list showing
 * five. `tolerance` omitted answers over the server's default of ± 5 gr — so a
 * member on "Exact" reads 17 on a powder chip and taps through to 9, and a
 * member on "± 15 gr" reads 9 and taps through to 31. Optional, both were
 * forgettable; required, tsc names the surface that forgot.
 *
 * ⚠️ `off` IS ONE FLAT LIST, ALL THREE AXES, exactly as the loads query sends
 * it — the server matches each axis against the same set. See bulletKey() in
 * components/bench/contract.ts for the shape of a bullet's entry.
 */
export interface BenchScope {
  /** Bench entries the member has switched off for this search only. */
  off: string[];
  /**
   * The grain window the results beside this count were found over.
   *
   * 🚨 A SEARCH WIDTH, NEVER A CHARGE — see LoadQuery.tolerance. It is here so
   * a count and the list it describes are the same question, and for no other
   * reason.
   */
  tolerance: number;
  /**
   * The cartridge tab and the weight band the list is narrowed to. The server
   * applies both to the powder chips' counts and to the spec card's "from
   * your bench" since the 2026-09-06 audit; sent without them a count is
   * taken over the whole shelf while the list beside it is narrowed.
   */
  cartridge?: LoadQuery['cartridge'];
  weight?: LoadQuery['weight'];
}

function scopeParam(scope: BenchScope, extra?: Record<string, string>): string {
  const p = new URLSearchParams(extra);
  if (scope.off.length) p.set('off', scope.off.join(','));
  if (scope.cartridge && scope.cartridge !== 'all') p.set('cartridge', scope.cartridge);
  if (scope.weight && scope.weight !== 'any') p.set('weight', scope.weight);
  setTolerance(p, scope.tolerance);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const benchApi = {
  me: (t: TokenGetter) => call<BenchView>(t, '/me'),

  /**
   * ⚠️ PUT REPLACES THE WHOLE BENCH, IT DOES NOT MERGE. BenchService.putBench
   * writes `powderIds: body.powderIds ?? []` for every axis, so a body that
   * omits one clears it. Sending `{ units }` alone would wipe every powder,
   * bullet and cartridge the member owns — and nothing would error, because
   * an empty bench is a legal bench.
   *
   * The parameter type therefore demands the complete bench. Always build it
   * from the current one: `saveBench(t, { ...bench, units: next })`.
   */
  saveBench: (
    t: TokenGetter,
    body: { powderIds: string[]; bullets: BenchBullet[]; cartridgeKeys: string[]; units: string },
  ) => call<BenchView>(t, '/me', { method: 'PUT', body: JSON.stringify(body) }),

  loads: (t: TokenGetter, q: LoadQuery = {}, o: BenchReadOpts = {}) =>
    call<LoadsResponse>(t, `/loads${query(q)}`, o),

  bullets: (t: TokenGetter, o: BenchReadOpts = {}) => call<BenchBulletOption[]>(t, '/bullets', o),

  cartridgeList: (t: TokenGetter, o: BenchReadOpts = {}) =>
    call<BenchCartridgeOption[]>(t, '/cartridges', o),

  /**
   * Each row's `loadsForBench` is a promise about what tapping that powder
   * will show, so the scope it is counted over is the results' — see
   * BenchScope.
   */
  powders: (
    t: TokenGetter,
    search: string | undefined,
    scope: BenchScope,
    o: BenchReadOpts = {},
  ) =>
    call<BenchPowder[]>(t, `/powders${scopeParam(scope, search ? { q: search } : undefined)}`, o),

  /** The card's `loadsForBench` is the same promise — see BenchScope. */
  cartridge: (t: TokenGetter, key: string, scope: BenchScope, o: BenchReadOpts = {}) =>
    call<CartridgeSpec>(t, `/cartridges/${encodeURIComponent(key)}${scopeParam(scope)}`, o),

  log: (t: TokenGetter, o: BenchReadOpts = {}) => call<LogEntry[]>(t, '/log', o),

  addLog: (t: TokenGetter, body: Record<string, unknown>) =>
    call<LogEntry>(t, '/log', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * The results a member adds after the range.
   *
   * ⚠️ PATCH, NOT PUT: the entry's charge, COAL, primer, case and date are the
   * record of a round that has already been fired and are not editable here.
   * Only the three measurements move, and only the keys sent move at all.
   */
  updateLog: (t: TokenGetter, id: string, patch: LogResultsPatch) =>
    call<LogEntry>(t, `/log/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteLog: (t: TokenGetter, id: string) =>
    call<void>(t, `/log/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Store this finder state and hand back a link to it.
   *
   * ⚠️ THE `payload` WRAPPER IS NOT DECORATION. ShareBenchDto declares exactly
   * one property, and the global ValidationPipe runs with `whitelist: true` —
   * so a body posted as the filter object itself is stripped field by field
   * and stored as an empty object. Nothing errors: the link is created, opens,
   * and applies nothing.
   */
  share: (t: TokenGetter, payload: BenchSharePayload) =>
    call<BenchShare>(t, '/share', { method: 'POST', body: JSON.stringify({ payload }) }),

  /**
   * Read one back.
   *
   * ⚠️ THE SERVER ANSWERS `{ token, payload, expiresAt }` AND THIS UNWRAPS IT.
   * A 404 is an expired or unknown token, and the caller's job is to leave the
   * member on their own bench and say so — never a half-applied filter set.
   */
  getShare: (t: TokenGetter, token: string, o: BenchReadOpts = {}) =>
    call<{ token: string; payload: BenchSharePayload; expiresAt: string }>(
      t,
      `/share/${encodeURIComponent(token)}`,
      o,
    ).then((r) => r?.payload ?? null),
};
