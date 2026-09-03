// warden/src/checks/unknown-rule.test.ts
//
// 🚨 THE RULE THIS WHOLE DESIGN EXISTS FOR: a plausible zero for something
// nobody measured is worse than no answer at all.
//
// Every check in the registry is run against a world where NOTHING is
// available — no files, no commands, no database, no network. Not one of
// them may come back ok, warn or bad: they measured nothing, so the only
// honest status is unknown, with a reason. This is a mutation test by
// construction — swap any check's failure path for a cheerful default
// ("0 errors", "no stale jobs", "not configured") and this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CHECKS } from './registry.js';
import { runOne } from './engine.js';
import { fakeContext } from './testing.js';

test('with nothing measurable, EVERY registered check returns unknown with a reason', async () => {
  const ctx = fakeContext(); // the empty world: every accessor fails, with a stated error
  const wrong: string[] = [];

  for (const check of ALL_CHECKS) {
    const result = await runOne(check, ctx);
    if (result.status !== 'unknown') {
      wrong.push(`${check.id} returned ${result.status}: ${result.verdict}`);
      continue;
    }
    assert.ok(result.reason && result.reason.trim().length > 0, `${check.id} returned unknown with no reason`);
    assert.match(result.verdict, /^Not measured — /, `${check.id} phrased an unknown as a finding`);
  }

  assert.deepEqual(wrong, [], 'these checks claimed a result they could not have measured');
});

test('the registry is not empty and every check declares a cadence and a cost', () => {
  assert.ok(ALL_CHECKS.length >= 20, `expected the operator's full list; got ${ALL_CHECKS.length} checks`);
  for (const check of ALL_CHECKS) {
    assert.ok(check.id.length > 0, 'a check with no id cannot be addressed');
    assert.ok(check.title.length > 0, `${check.id} has no title`);
    assert.ok(check.cadenceMs > 0, `${check.id} declares no cadence — it would re-run on every sweep`);
    assert.ok(['cheap', 'moderate', 'expensive'].includes(check.cost), `${check.id} declares no cost`);
  }
});

test('the operator’s list is covered — each named area has at least one check', () => {
  const ids = ALL_CHECKS.map((c) => c.id);
  for (const area of [
    'host-disk',
    'host-memory',
    'host-load',
    'host-uptime',
    'tls-edge',
    'tls-origin',
    'nginx-error-rate',
    'nginx-error-log',
    'nginx-proxy-timeout',
    'pm2-processes',
    'pm2-crash-output',
    'db-reachable',
    'db-connections',
    'db-size',
    'db-slow-queries',
    'db-migration-drift',
    'backup-last-run',
    'backup-artifacts',
    'backup-set-gap',
    'env-backend',
    'env-frontend',
    'cron-freshness',
    'channel-email',
    'channel-sms',
    'channel-push',
    'channel-whatsapp',
    'app-gates',
    'app-courier-bookings',
    'app-queue-depth',
  ]) {
    assert.ok(ids.includes(area), `no check covers ${area}`);
  }
});
