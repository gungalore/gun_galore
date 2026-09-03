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
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BenchApiError';
  }
}

async function call<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/bench${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new BenchApiError(body || `Request failed (${res.status})`, res.status);
  }
  // safeJson needs an explicit fallback; null is right here because the only
  // bodiless response on this API is DELETE /log/:id, whose caller ignores it.
  return (await safeJson<T | null>(res, null)) as T;
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
}

function scopeParam(scope: BenchScope, extra?: Record<string, string>): string {
  const p = new URLSearchParams(extra);
  if (scope.off.length) p.set('off', scope.off.join(','));
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

  loads: (t: TokenGetter, q: LoadQuery = {}) => call<LoadsResponse>(t, `/loads${query(q)}`),

  bullets: (t: TokenGetter) => call<BenchBulletOption[]>(t, '/bullets'),

  cartridgeList: (t: TokenGetter) => call<BenchCartridgeOption[]>(t, '/cartridges'),

  /**
   * Each row's `loadsForBench` is a promise about what tapping that powder
   * will show, so the scope it is counted over is the results' — see
   * BenchScope.
   */
  powders: (t: TokenGetter, search: string | undefined, scope: BenchScope) =>
    call<BenchPowder[]>(t, `/powders${scopeParam(scope, search ? { q: search } : undefined)}`),

  /** The card's `loadsForBench` is the same promise — see BenchScope. */
  cartridge: (t: TokenGetter, key: string, scope: BenchScope) =>
    call<CartridgeSpec>(t, `/cartridges/${encodeURIComponent(key)}${scopeParam(scope)}`),

  log: (t: TokenGetter) => call<LogEntry[]>(t, '/log'),

  addLog: (t: TokenGetter, body: Record<string, unknown>) =>
    call<LogEntry>(t, '/log', { method: 'POST', body: JSON.stringify(body) }),

  deleteLog: (t: TokenGetter, id: string) =>
    call<void>(t, `/log/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
