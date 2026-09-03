// warden/src/checks/cron.ts
//
// Scheduled-job freshness, answered by the APP'S OWN definition of stale
// rather than by a second copy of it kept here.
//
// The backend already knows all 28 jobs and their intervals
// (admin-health.service.ts::cronStatuses) and already exposes the verdict
// at GET /health/crons?key=HEALTH_PING_SECRET — deliberately unauthenticated
// but secret-gated "for a headless monitor". Warden IS that headless
// monitor, over loopback. Re-deriving the 28 intervals inside Warden would
// repeat a bug this codebase has already shipped twice: an interval that
// was wrong for half of every hour, and orphaned rows for a feature that
// had been deleted. One source of truth, and it is not this file.
//
// The raw Setting heartbeats are read separately, as EVIDENCE only — a
// per-job table for the operator to look at. The pass/fail verdict still
// comes from the endpoint, so the two can never disagree about staleness.
//
// 🚨 HEALTH_PING_SECRET goes in a query string. It is never put in an
// evidence line, an error message or a log — the URL is rendered with the
// key redacted, and CheckContext.httpGetJson deliberately keeps the URL
// out of its own error text.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { ageWords, bad, ev, notMeasured, ok, parseDate, unknown, warn } from './result.js';
import { parseEnvPresence } from './lib/parse.js';

export const cronFreshnessCheck: CheckModule = {
  id: 'cron-freshness',
  title: 'Scheduled jobs',
  cost: 'cheap',
  cadenceMs: 5 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const envFile = await ctx.readFile(ctx.config.backendEnvPath);
    if (!envFile.ok) return unknown(`cannot read the backend env file to find HEALTH_PING_SECRET — ${envFile.error}`);
    // No allowlist passed: this parse carries lengths only, and the value
    // is pulled out here by name, used once, and never stored.
    const secret = readSecret(envFile.value, 'HEALTH_PING_SECRET');
    if (!secret) {
      return unknown(
        'HEALTH_PING_SECRET is not set in the backend env, so /health/crons answers "not configured" — job freshness cannot be read at all',
      );
    }

    const redactedUrl = `GET ${ctx.config.apiBaseUrl}/health/crons?key=<redacted>`;
    const res = await ctx.httpGetJson(`${ctx.config.apiBaseUrl}/health/crons?key=${encodeURIComponent(secret)}`, {
      timeoutMs: 6_000,
    });
    if (!res.ok) return unknown(`${res.error} (${redactedUrl})`);

    const body = res.value.body as { ok?: unknown; stale?: unknown; error?: unknown } | null;
    const evidence: Evidence[] = [ev('endpoint', `${res.value.status} — ${redactedUrl}`)];

    // A wrong key gives 503 with the same "not configured" shape as an
    // unset secret. Both mean "nobody measured", never "nothing is stale".
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      return unknown(`/health/crons answered "${body.error}" — the endpoint is not configured or the key does not match`, evidence);
    }

    const heartbeats = await ctx.queryDb(`select key, "updatedAt"::text from "Setting" where key like 'cron:lastrun:%' order by key`, {
      timeoutMs: 8_000,
    });
    if (heartbeats.ok) {
      const now = ctx.now();
      for (const row of heartbeats.value) {
        const at = parseDate(row[1]);
        evidence.push(
          ev(
            (row[0] ?? '').replace('cron:lastrun:', ''),
            at ? `${ageWords(at, now)} ago` : `unreadable timestamp (${row[1] ?? ''})`,
            'psql -c "select key, \\"updatedAt\\" from \\"Setting\\" where key like \'cron:lastrun:%\'"',
          ),
        );
      }
    } else {
      evidence.push(notMeasured('per-job heartbeats', heartbeats.error));
    }

    const stale = Array.isArray(body?.stale) ? (body!.stale as unknown[]).map(String) : [];
    if (body?.ok === true) return ok('Every scheduled job has run within its expected interval.', evidence);
    if (stale.length > 0) {
      evidence.unshift(ev('stale jobs', stale.join(', ')));
      return bad(`${stale.length} scheduled job${stale.length === 1 ? ' is' : 's are'} stale: ${stale.join(', ')}.`, evidence);
    }
    // ok:false with no stale list is a shape we do not recognise — say so
    // rather than guessing which way it means.
    return warn(`/health/crons answered ${res.value.status} in a shape Warden does not recognise.`, evidence);
  },
};

export const cronChecks: CheckModule[] = [cronFreshnessCheck];

/** Pull one value out of a dotenv blob for immediate use. Deliberately not
 *  exported and never stored: the returned string goes straight into one
 *  request and is dropped. */
function readSecret(envText: string, key: string): string | null {
  // parseEnvPresence with a one-key allowlist keeps the single-parse rule
  // (one dotenv spelling in this file tree) while still limiting what can
  // come out to exactly the key asked for.
  const parsed = parseEnvPresence(envText, new Set([key]));
  return parsed.get(key)?.value ?? null;
}
