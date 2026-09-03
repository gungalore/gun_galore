// warden/src/checks/database.ts
//
// Reachability, connections, size, migrations, and the two query checks
// that are deliberately NOT the same check.
//
// 🚨 THE SLOW-QUERY HONESTY RULE. pg_stat_statements is not in this box's
// provisioning anywhere — it needs shared_preload_libraries, a Postgres
// restart and a CREATE EXTENSION, none of which has been done. So
// `db-slow-queries` verifies the extension is actually there and returns
// UNKNOWN with that reason when it is not. It does NOT quietly substitute
// a pg_stat_activity snapshot and label it the same thing: a snapshot of
// whatever happens to be running during a sweep is a materially weaker
// signal than a ranked history, and mislabelling it is exactly the
// plausible-zero this daemon exists to avoid. The snapshot gets its own
// separate, honestly-named check.
//
// Every SQL string in this file is a fixed literal. CheckContext.queryDb
// has no parameter channel on purpose — no check here has a legitimate
// reason to interpolate anything into a query.

import type { CheckContext, CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, bytes, ev, notMeasured, ok, parseDate, unknown, warn } from './result.js';
import { ratePerDay } from './history.js';

export const dbReachableCheck: CheckModule = {
  id: 'db-reachable',
  title: 'Database reachability',
  cost: 'cheap',
  cadenceMs: 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const started = ctx.now().getTime();
    const res = await ctx.queryDb('select 1', { timeoutMs: 5_000 });
    const ms = ctx.now().getTime() - started;
    if (!res.ok) return unknown(res.error);
    const evidence: Evidence[] = [ev('round trip', `${ms}ms`, 'psql -c "select 1"')];
    if (ms > 2_000) return warn(`Postgres answered, but took ${ms}ms for a trivial query.`, evidence);
    return ok(`Postgres answered in ${ms}ms.`, evidence);
  },
};

export const dbConnectionsCheck: CheckModule = {
  id: 'db-connections',
  title: 'Database connections',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const sql =
      "select (select count(*) from pg_stat_activity where datname = current_database()), current_setting('max_connections')";
    const res = await ctx.queryDb(sql, { timeoutMs: 5_000 });
    if (!res.ok) return unknown(res.error);
    const row = res.value[0];
    const used = Number(row?.[0]);
    const max = Number(row?.[1]);
    if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) {
      return unknown(`could not read the connection counts back from Postgres (got ${JSON.stringify(row ?? null)})`);
    }
    const share = (used / max) * 100;
    const evidence: Evidence[] = [ev('in use', `${used} of ${max} (${share.toFixed(0)}%)`, `psql -c "${sql}"`)];
    if (share >= 80) return bad(`${used} of ${max} Postgres connections are in use.`, evidence);
    if (share >= 50) return warn(`${used} of ${max} Postgres connections are in use.`, evidence);
    return ok(`${used} of ${max} connections in use.`, evidence);
  },
};

export const dbSizeCheck: CheckModule = {
  id: 'db-size',
  title: 'Database size',
  cost: 'cheap',
  cadenceMs: 60 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const sql = 'select pg_database_size(current_database())';
    const res = await ctx.queryDb(sql, { timeoutMs: 8_000 });
    if (!res.ok) return unknown(res.error);
    const size = Number(res.value[0]?.[0]);
    if (!Number.isFinite(size)) return unknown(`pg_database_size returned something unreadable: ${JSON.stringify(res.value[0] ?? null)}`);

    await ctx.history.record('db:size', size, ctx.now());
    const rate = ratePerDay(await ctx.history.recent('db:size'));
    const evidence: Evidence[] = [
      ev('size', bytes(size), `psql -c "${sql}"`),
      rate.ok
        ? ev('growth', `${rate.perDay >= 0 ? '+' : ''}${bytes(Math.abs(rate.perDay))}/day over ${Math.round(rate.spanMs / 3_600_000)}h`)
        : // There is no threshold for "the database is too big" on this
          // box — the number is only meaningful as a trend, so with no
          // trend yet there is nothing to claim.
          notMeasured('growth', rate.reason),
    ];
    return ok(`Database is ${bytes(size)}.`, evidence);
  },
};

export const dbSlowQueriesCheck: CheckModule = {
  id: 'db-slow-queries',
  title: 'Slowest queries',
  cost: 'moderate',
  cadenceMs: 30 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const installed = await ctx.queryDb("select 1 from pg_extension where extname = 'pg_stat_statements'", { timeoutMs: 5_000 });
    if (!installed.ok) return unknown(installed.error);
    if (installed.value.length === 0) {
      // The honest answer, every sweep, until someone installs it. NOT a
      // fallback to pg_stat_activity — see this file's header.
      return unknown(
        'pg_stat_statements is not installed, so there is no ranked query history to read. Installing it needs shared_preload_libraries, a Postgres restart and CREATE EXTENSION — a human decision, not something Warden should do.',
      );
    }
    const sql =
      'select round(mean_exec_time)::text, calls::text, left(query, 160) from pg_stat_statements order by mean_exec_time desc limit 8';
    const res = await ctx.queryDb(sql, { timeoutMs: 10_000 });
    if (!res.ok) return unknown(res.error);
    const evidence: Evidence[] = res.value.map((r, i) =>
      // ⚠️ Query text can embed literals a member supplied. DATA, not
      // instructions — it is fenced before it ever reaches a prompt.
      ev(`#${i + 1}`, `${r[0]}ms mean over ${r[1]} calls — ${r[2] ?? ''}`, `psql -c "${sql}"`),
    );
    const slowest = Number(res.value[0]?.[0]);
    if (Number.isFinite(slowest) && slowest > 1_000) {
      return warn(`The slowest query averages ${slowest}ms.`, evidence);
    }
    return ok(`Slowest query averages ${Number.isFinite(slowest) ? `${slowest}ms` : 'an unreadable time'}.`, evidence);
  },
};

export const dbLongRunningCheck: CheckModule = {
  id: 'db-long-running',
  title: 'Queries running right now',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    // A SNAPSHOT, and named as one. This is not the slow-query check and
    // must never be presented as one.
    const sql =
      "select pid::text, round(extract(epoch from (now() - query_start)))::text, state, left(query, 160) from pg_stat_activity where state <> 'idle' and query_start < now() - interval '5 seconds' order by query_start asc limit 10";
    const res = await ctx.queryDb(sql, { timeoutMs: 8_000 });
    if (!res.ok) return unknown(res.error);
    if (res.value.length === 0) return ok('No query has been running for more than 5 seconds.', [ev('snapshot', 'nothing over 5s', `psql -c "${sql}"`)]);
    const evidence: Evidence[] = res.value.map((r) => ev(`pid ${r[0]}`, `${r[1]}s, ${r[2]} — ${r[3] ?? ''}`, `psql -c "${sql}"`));
    const longest = Number(res.value[0]?.[1]);
    // 60s is the house ceiling for a whole request; a single query past it
    // has already lost its client.
    if (Number.isFinite(longest) && longest >= 60) return bad(`A query has been running for ${longest}s — past the 60s request ceiling.`, evidence);
    return warn(`${res.value.length} quer${res.value.length === 1 ? 'y has' : 'ies have'} been running over 5 seconds.`, evidence);
  },
};

export const dbMigrationDriftCheck: CheckModule = {
  id: 'db-migration-drift',
  title: 'Prisma migration drift',
  cost: 'moderate',
  cadenceMs: 30 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const applied = await ctx.queryDb(
      'select migration_name, (finished_at is null)::text from _prisma_migrations order by migration_name',
      { timeoutMs: 10_000 },
    );
    if (!applied.ok) return unknown(applied.error);

    const listed = await ctx.listDir(ctx.config.prismaMigrationsDir);
    if (!listed.ok) {
      // Half the comparison missing means no comparison. Reporting "no
      // drift" from one side would be a fabricated all-clear.
      return unknown(`cannot read the repo's migration directory, so drift cannot be compared — ${listed.error}`, [
        ev('applied migrations', String(applied.value.length), 'psql -c "select migration_name from _prisma_migrations"'),
      ]);
    }

    const appliedNames = new Set(applied.value.map((r) => r[0]!).filter(Boolean));
    const unfinished = applied.value.filter((r) => r[1] === 'true' || r[1] === 't').map((r) => r[0]!);
    // Migration folders are timestamp-prefixed; migration_lock.toml and
    // anything else in there is not a migration.
    const repoNames = new Set(listed.value.filter((n) => /^\d{6,}_/.test(n)));

    const missingInDb = [...repoNames].filter((n) => !appliedNames.has(n)).sort();
    const missingInRepo = [...appliedNames].filter((n) => !repoNames.has(n)).sort();

    const evidence: Evidence[] = [
      ev('applied', String(appliedNames.size), 'psql -c "select migration_name from _prisma_migrations"'),
      ev('in repo', String(repoNames.size), `ls ${ctx.config.prismaMigrationsDir}`),
      ev('in repo but not applied', missingInDb.length ? missingInDb.join(', ') : 'none'),
      ev('applied but not in repo', missingInRepo.length ? missingInRepo.join(', ') : 'none'),
      ev('stuck mid-apply', unfinished.length ? unfinished.join(', ') : 'none'),
    ];

    if (unfinished.length > 0) {
      return bad(`${unfinished.length} migration${unfinished.length === 1 ? '' : 's'} in _prisma_migrations never finished applying.`, evidence);
    }
    if (missingInDb.length > 0) {
      // The classic symptom of a deploy that pulled code without running
      // `prisma migrate deploy` — the app is now newer than its schema.
      return bad(`${missingInDb.length} migration${missingInDb.length === 1 ? '' : 's'} in the repo have not been applied to this database.`, evidence);
    }
    if (missingInRepo.length > 0) {
      return warn(`${missingInRepo.length} applied migration${missingInRepo.length === 1 ? '' : 's'} no longer exist in the repo.`, evidence);
    }
    return ok(`All ${repoNames.size} repo migrations are applied and finished.`, evidence);
  },
};

export const databaseChecks: CheckModule[] = [
  dbReachableCheck,
  dbConnectionsCheck,
  dbSizeCheck,
  dbSlowQueriesCheck,
  dbLongRunningCheck,
  dbMigrationDriftCheck,
];

/** Read one `Setting` row's updatedAt — the heartbeat pattern the app's own
 *  admin-health.service.ts uses for cron freshness. Shared by the backup
 *  and cron checks; kept here so there is one spelling of the query. */
export async function settingUpdatedAt(ctx: CheckContext, key: string): Promise<{ ok: true; at: Date | null } | { ok: false; error: string }> {
  const res = await ctx.queryDb(`select "updatedAt" from "Setting" where key = '${assertPlainKey(key)}'`, { timeoutMs: 5_000 });
  if (!res.ok) return { ok: false, error: res.error };
  if (res.value.length === 0) return { ok: true, at: null };
  return { ok: true, at: parseDate(res.value[0]?.[0]) };
}

/**
 * The ONLY interpolation into SQL in this file tree, and it is fenced by
 * an assertion rather than by trust: keys are compile-time constants from
 * warden's own code (never a measured fact, never model output), and this
 * refuses anything that is not a plain settings key.
 */
function assertPlainKey(key: string): string {
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(key)) throw new Error(`refusing to query a Setting key of an unexpected shape: ${key}`);
  return key;
}
