// warden/src/checks/engine.ts
//
// THE SWEEP. Fixed code running fixed checks; there is no model anywhere in
// this file tree, and facts are complete before Claude is ever called.
//
// Three properties this file is responsible for, all of them load-bearing:
//
//   1. ONE CHECK CANNOT TAKE THE SWEEP DOWN. Every check runs inside a
//      try/catch AND a timeout. A throw becomes THAT check's unknown with
//      the error as its reason; a hang becomes THAT check's unknown with
//      the budget as its reason. The other twenty-four still report. A
//      sweep that dies on one bad check is a board that goes blank, which
//      is worse than any single red row.
//
//   2. AN UNKNOWN IS NEVER A ZERO. The engine never invents a status, a
//      number or a verdict on a check's behalf. The only text it writes
//      for a failed check is "Not measured — <reason>".
//
//   3. THE SWEEP NEVER BLOCKS AN HTTP REQUEST. GET /chat has an 8s budget
//      on the backend's side and is served from the last completed sweep;
//      runSweep() is called by the daemon's own loop, never inline in a
//      request handler. Cadence is what keeps that loop cheap: a check
//      that is not due is carried forward with `fresh: false`, not re-run.

import type {
  CheckContext,
  CheckModule,
  CheckOutcome,
  CheckResult,
  CheckStatus,
  Sweep,
} from '../types.js';

/** Per-cost defaults, used when a check declares no `timeoutMs` of its
 *  own. Generous enough that a slow-but-working box is not reported as
 *  broken, tight enough that a wedged binary cannot stall a sweep. */
const DEFAULT_TIMEOUT_BY_COST: Record<CheckModule['cost'], number> = {
  cheap: 5_000,
  moderate: 20_000,
  expensive: 60_000,
};

/** How many checks may be in flight at once. The box runs a live site;
 *  a sweep is a background chore and must not itself be the load spike. */
const DEFAULT_CONCURRENCY = 4;

export interface SweepMemory {
  /** checkId -> the last result the engine produced for it. */
  results: Map<string, CheckResult>;
}

export function createSweepMemory(): SweepMemory {
  return { results: new Map() };
}

export interface SweepOptions {
  /** Run these ids only (still subject to `force` / cadence). */
  only?: string[];
  /** Ignore cadence and re-measure everything. Used by "re-check after a
   *  fix", which must never be answered from a cached row. */
  force?: boolean;
  concurrency?: number;
}

/**
 * Run every due check and return the whole board — due or not. The result
 * array always has one row per registered check, in registration order, so
 * a check that started throwing cannot quietly disappear from the board.
 */
export async function runSweep(
  checks: readonly CheckModule[],
  ctx: CheckContext,
  memory: SweepMemory,
  options: SweepOptions = {},
): Promise<Sweep> {
  const startedAt = ctx.now();
  const only = options.only ? new Set(options.only) : null;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const due: CheckModule[] = [];
  for (const check of checks) {
    if (only && !only.has(check.id)) continue;
    if (options.force || isDue(check, memory, startedAt)) due.push(check);
  }

  await inPool(due, concurrency, async (check) => {
    const result = await runOne(check, ctx);
    memory.results.set(check.id, result);
  });

  const results: CheckResult[] = [];
  for (const check of checks) {
    const previous = memory.results.get(check.id);
    results.push(previous ? { ...previous, fresh: due.includes(check) } : neverRunRow(check, startedAt));
  }

  const finishedAt = ctx.now();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    results,
    counts: tally(results),
  };
}

/**
 * Run ONE check with both guards on. Exported because "re-check after a
 * fix" wants exactly one check re-measured now, with no cadence in the
 * way, and it must get the same isolation the sweep gives.
 */
export async function runOne(check: CheckModule, ctx: CheckContext): Promise<CheckResult> {
  const startedAt = ctx.now();
  const budget = check.timeoutMs ?? DEFAULT_TIMEOUT_BY_COST[check.cost];
  const outcome = await withTimeout(check, ctx, budget);
  const finishedAt = ctx.now();
  return stamp(check, outcome, startedAt, Math.max(0, finishedAt.getTime() - startedAt.getTime()));
}

// ── the two guards ──────────────────────────────────────────────────────

async function withTimeout(check: CheckModule, ctx: CheckContext, budgetMs: number): Promise<CheckOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: 'unknown',
          reason: `check did not finish within ${budgetMs}ms and was abandoned`,
        }),
      budgetMs,
    );
    // The sweep must not hold the process open just because a check is
    // still pending — the daemon's HTTP server is what keeps it alive.
    timer.unref?.();
  });

  // ⚠️ The catch is attached to the ORIGINAL promise, not to the race.
  // A check that rejects AFTER we have already resolved on the timeout
  // would otherwise become an unhandled rejection and, under Node's
  // default, kill the daemon — the exact "one check takes the sweep down"
  // failure this function exists to prevent, arriving by the back door.
  const work = Promise.resolve()
    .then(() => check.run(ctx))
    .catch((err: unknown) => threw(err));

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function threw(err: unknown): CheckOutcome {
  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  // A check that throws has measured NOTHING. It is unknown — never ok
  // ("no errors found"), never bad ("something is wrong"): both would be
  // claims about the box drawn from a bug in Warden.
  return { status: 'unknown', reason: `check threw before it could measure anything — ${message}` };
}

// ── shaping ─────────────────────────────────────────────────────────────

function stamp(check: CheckModule, outcome: CheckOutcome, at: Date, durationMs: number): CheckResult {
  const base = {
    id: check.id,
    title: check.title,
    cost: check.cost,
    measuredAt: at.toISOString(),
    durationMs,
    fresh: true,
  };
  if (outcome.status === 'unknown') {
    return {
      ...base,
      status: 'unknown',
      // The ONLY verdict text the engine ever writes. A check cannot
      // supply prose for an outcome it did not measure.
      verdict: `Not measured — ${outcome.reason}`,
      evidence: outcome.evidence ?? [],
      reason: outcome.reason,
      standing: false,
      gateKey: outcome.gateKey ?? null,
    };
  }
  return {
    ...base,
    status: outcome.status,
    verdict: outcome.verdict,
    evidence: outcome.evidence,
    reason: null,
    standing: outcome.standing === true,
    gateKey: outcome.gateKey ?? null,
  };
}

/** A registered check that has never run yet (cadence has not come round
 *  on a fresh daemon, or `only` excluded it). Unknown, with that as the
 *  stated reason — the board draws an em dash rather than an implied ok. */
function neverRunRow(check: CheckModule, at: Date): CheckResult {
  return {
    id: check.id,
    title: check.title,
    cost: check.cost,
    status: 'unknown',
    verdict: 'Not measured — not run yet in this daemon process',
    evidence: [],
    reason: 'not run yet in this daemon process',
    standing: false,
    gateKey: null,
    measuredAt: at.toISOString(),
    durationMs: 0,
    fresh: false,
  };
}

function isDue(check: CheckModule, memory: SweepMemory, now: Date): boolean {
  const previous = memory.results.get(check.id);
  if (!previous) return true;
  const last = new Date(previous.measuredAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= check.cadenceMs;
}

function tally(results: CheckResult[]): Record<CheckStatus, number> {
  // Every key present with a zero — a sparse object would make "no bad
  // rows" and "bad rows not counted" indistinguishable downstream.
  const counts: Record<CheckStatus, number> = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const r of results) counts[r.status] += 1;
  return counts;
}

async function inPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      // worker() is runOne(), which never rejects. Belt and braces: if a
      // future edit makes it reject, one worker dying must not strand the
      // remaining items behind an unresolved pool.
      await worker(items[index]!).catch(() => undefined);
    }
  });
  await Promise.all(runners);
}
