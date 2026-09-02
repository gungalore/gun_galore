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

export interface LoadsResponse {
  count: number;
  groups: LoadGroup[];
}

export interface BenchPowder {
  id: string;
  name: string;
  maker: string | null;
  loadsForBench?: number;
}

export interface BenchBullet {
  maker: string;
  weightGr: number;
  category: string;
  /** Inches. Absent on benches saved before calibres were recorded. */
  calibreIn?: number | null;
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
  maker: string;
  weightGr: number;
  /** FMJ | MONO | TIP | HP | CAST | SP | OTHER. */
  category: string;
  /**
   * 🚨 A WEIGHT IS NOT A BULLET. "Hornady 150gr SP" names four different
   * projectiles — .277 for .270 Win, .308 for .308 Win, .311 for .303
   * British, .323 for 8x57 — and they are not interchangeable. Without this
   * the picker showed one row for all four, and the results told a member
   * they could build loads their bullets do not fit. Inches; null only where
   * no C.I.P. sheet gives a diameter.
   */
  calibreIn: number | null;
  /**
   * How many consolidated loads use it.
   *
   * ⚠️ NEVER A COUNT OF WHAT THOSE LOADS WERE BUILT FROM. Operator ruling
   * 2026-09-02; the backend's leak spec is the other half of this boundary.
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
  stations: unknown[];
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
  cartridge?: string;
  weight?: string;
  /** Bench entries the member has switched off for this search only. */
  off?: string[];
}

function query(q: LoadQuery): string {
  const p = new URLSearchParams();
  if (q.cartridge && q.cartridge !== 'all') p.set('cartridge', q.cartridge);
  if (q.weight && q.weight !== 'any') p.set('weight', q.weight);
  if (q.off?.length) p.set('off', q.off.join(','));
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

  powders: (t: TokenGetter, search?: string) =>
    call<BenchPowder[]>(t, `/powders${search ? `?q=${encodeURIComponent(search)}` : ''}`),

  cartridge: (t: TokenGetter, key: string) =>
    call<CartridgeSpec>(t, `/cartridges/${encodeURIComponent(key)}`),

  log: (t: TokenGetter) => call<LogEntry[]>(t, '/log'),

  addLog: (t: TokenGetter, body: Record<string, unknown>) =>
    call<LogEntry>(t, '/log', { method: 'POST', body: JSON.stringify(body) }),

  deleteLog: (t: TokenGetter, id: string) =>
    call<void>(t, `/log/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
