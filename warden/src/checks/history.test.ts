// warden/src/checks/history.test.ts
//
// A rate with one sample is the plausible zero wearing a lab coat: "+0
// GiB/day" and "we have never looked twice" render identically on a board
// and mean opposite things. ratePerDay must refuse, with a reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHistory, MIN_RATE_SPAN_MS, ratePerDay } from './history.js';

test('no samples and one sample both refuse, and say which', () => {
  const none = ratePerDay([]);
  assert.equal(none.ok, false);
  assert.match(none.ok ? '' : none.reason, /insufficient history \(0 samples/);

  const one = ratePerDay([{ at: '2026-09-03T08:00:00.000Z', value: 100 }]);
  assert.equal(one.ok, false);
  assert.match(one.ok ? '' : one.reason, /insufficient history \(1 sample;/);
});

test('two samples too close together refuse rather than extrapolate', () => {
  const rate = ratePerDay([
    { at: '2026-09-03T08:00:00.000Z', value: 100 },
    { at: '2026-09-03T08:04:00.000Z', value: 110 },
  ]);
  assert.equal(rate.ok, false);
  // Four minutes of samples would extrapolate to 3.6 GB/day from a 10-byte
  // blip. Refusing is the correct answer.
  assert.match(rate.ok ? '' : rate.reason, /4 minutes of samples; need 30/);
});

test('a real window gives a real rate', () => {
  const rate = ratePerDay([
    { at: '2026-09-02T08:00:00.000Z', value: 1_000 },
    { at: '2026-09-03T08:00:00.000Z', value: 3_000 },
  ]);
  assert.equal(rate.ok, true);
  assert.equal(rate.ok && Math.round(rate.perDay), 2_000);
  assert.equal(rate.ok && rate.samples, 2);
});

test('samples out of order refuse instead of returning a negative-span nonsense rate', () => {
  const rate = ratePerDay([
    { at: '2026-09-03T08:00:00.000Z', value: 3_000 },
    { at: '2026-09-02T08:00:00.000Z', value: 1_000 },
  ]);
  assert.equal(rate.ok, false);
  assert.match(rate.ok ? '' : rate.reason, /not ordered in time/);
});

test('MemoryHistory keeps order and the caller can ask for a window', async () => {
  const history = new MemoryHistory();
  await history.record('disk:/', 10, new Date('2026-09-01T00:00:00.000Z'));
  await history.record('disk:/', 20, new Date('2026-09-02T00:00:00.000Z'));
  await history.record('disk:/', 30, new Date('2026-09-03T00:00:00.000Z'));

  const all = await history.recent('disk:/');
  assert.deepEqual(all.map((s) => s.value), [10, 20, 30]);
  const last2 = await history.recent('disk:/', 2);
  assert.deepEqual(last2.map((s) => s.value), [20, 30]);
  // An unknown series is empty, and ratePerDay then refuses — a check
  // asking about something never recorded gets "no history", not zero.
  assert.deepEqual(await history.recent('never:recorded'), []);
  assert.equal(ratePerDay(await history.recent('never:recorded'), MIN_RATE_SPAN_MS).ok, false);
});
