// warden/src/checks/engine.test.ts
//
// The two engine properties that are load-bearing, tested so that removing
// either one FAILS here rather than showing up as a blank board at 3am:
// a check that throws becomes that check's unknown, and a check that never
// finishes becomes that check's unknown — in both cases with the rest of
// the sweep intact.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createSweepMemory, runOne, runSweep } from './engine.js';
import { fakeContext } from './testing.js';
import { ev, ok, unknown } from './result.js';
import type { CheckContext, CheckModule } from '../types.js';

const healthy: CheckModule = {
  id: 'healthy',
  title: 'A check that works',
  cost: 'cheap',
  cadenceMs: 60_000,
  async run() {
    return ok('All fine.', [ev('n', '1')]);
  },
};

const thrower: CheckModule = {
  id: 'thrower',
  title: 'A check with a bug in it',
  cost: 'cheap',
  cadenceMs: 60_000,
  async run() {
    throw new Error('boom: cannot read properties of undefined');
  },
};

const hanger: CheckModule = {
  id: 'hanger',
  title: 'A check that never comes back',
  cost: 'cheap',
  cadenceMs: 60_000,
  timeoutMs: 25,
  run() {
    return new Promise(() => {
      /* never resolves — a wedged psql, an unreachable socket */
    });
  },
};

test('a throwing check becomes THAT check’s unknown and the sweep still completes', async () => {
  const ctx = fakeContext();
  const sweep = await runSweep([healthy, thrower], ctx, createSweepMemory());

  assert.equal(sweep.results.length, 2);
  const bad = sweep.results.find((r) => r.id === 'thrower')!;
  assert.equal(bad.status, 'unknown');
  // The reason must carry the actual error — "something went wrong" would
  // leave the operator with nothing to act on.
  assert.match(bad.reason ?? '', /boom: cannot read properties of undefined/);
  assert.match(bad.verdict, /^Not measured — /);

  // The other check still ran. This is the whole point.
  const good = sweep.results.find((r) => r.id === 'healthy')!;
  assert.equal(good.status, 'ok');
  assert.equal(good.verdict, 'All fine.');
});

test('a throwing check is never reported as ok or as bad — it measured nothing', async () => {
  const result = await runOne(thrower, fakeContext());
  assert.equal(result.status, 'unknown');
  assert.equal(result.evidence.length, 0);
  assert.equal(result.reason !== null && result.reason.length > 0, true);
});

test('a check that never finishes is abandoned and becomes an unknown, not a hung sweep', async () => {
  const started = Date.now();
  const sweep = await runSweep([hanger, healthy], fakeContext(), createSweepMemory());
  assert.ok(Date.now() - started < 2_000, 'the sweep must not wait on a hung check');
  const hung = sweep.results.find((r) => r.id === 'hanger')!;
  assert.equal(hung.status, 'unknown');
  assert.match(hung.reason ?? '', /did not finish within 25ms/);
  assert.equal(sweep.results.find((r) => r.id === 'healthy')!.status, 'ok');
});

test('a check that rejects AFTER its timeout does not become an unhandled rejection', async () => {
  const lateRejector: CheckModule = {
    id: 'late',
    title: 'Rejects after we have given up on it',
    cost: 'cheap',
    cadenceMs: 60_000,
    timeoutMs: 10,
    run: () => new Promise((_, reject) => setTimeout(() => reject(new Error('too late')), 60)),
  };
  const seen: unknown[] = [];
  const onUnhandled = (err: unknown) => seen.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await runOne(lateRejector, fakeContext());
    assert.equal(result.status, 'unknown');
    await delay(150); // let the late rejection land
    assert.deepEqual(seen, [], 'a late rejection must be caught on the original promise, not left to kill the daemon');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('the engine writes the verdict for an unknown — a check cannot phrase one as a finding', async () => {
  const sneaky: CheckModule = {
    id: 'sneaky',
    title: 'Tries to sound measured',
    cost: 'cheap',
    cadenceMs: 60_000,
    async run() {
      return unknown('the log could not be read (EACCES)');
    },
  };
  const result = await runOne(sneaky, fakeContext());
  assert.equal(result.verdict, 'Not measured — the log could not be read (EACCES)');
  assert.equal(result.status, 'unknown');
});

test('counts always carry all four statuses, zero included', async () => {
  const sweep = await runSweep([healthy], fakeContext(), createSweepMemory());
  assert.deepEqual(sweep.counts, { ok: 1, warn: 0, bad: 0, unknown: 0 });
});

test('a registered check that has not run is unknown with that reason — never an implied ok', async () => {
  const sweep = await runSweep([healthy, thrower], fakeContext(), createSweepMemory(), { only: ['healthy'] });
  const notRun = sweep.results.find((r) => r.id === 'thrower')!;
  assert.equal(notRun.status, 'unknown');
  assert.equal(notRun.reason, 'not run yet in this daemon process');
  assert.equal(notRun.fresh, false);
});

test('cadence skips a check that is not due, and force overrides it', async () => {
  let runs = 0;
  const counted: CheckModule = {
    id: 'counted',
    title: 'Counts its own runs',
    cost: 'cheap',
    cadenceMs: 10 * 60_000,
    async run() {
      runs += 1;
      return ok('fine', []);
    },
  };
  let clock = new Date('2026-09-03T08:00:00.000Z');
  const base = fakeContext();
  const ctx: CheckContext = { ...base, now: () => clock };
  const memory = createSweepMemory();

  await runSweep([counted], ctx, memory);
  assert.equal(runs, 1);

  clock = new Date('2026-09-03T08:05:00.000Z'); // inside the cadence
  const second = await runSweep([counted], ctx, memory);
  assert.equal(runs, 1, 'a check inside its cadence must be carried forward, not re-run');
  assert.equal(second.results[0]!.fresh, false);
  assert.equal(second.results[0]!.measuredAt, '2026-09-03T08:00:00.000Z');

  // "re-check after a fix" must never be answered from a cached row.
  await runSweep([counted], ctx, memory, { force: true });
  assert.equal(runs, 2);

  clock = new Date('2026-09-03T08:20:00.000Z'); // past the cadence
  await runSweep([counted], ctx, memory);
  assert.equal(runs, 3);
});
