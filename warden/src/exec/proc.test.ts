// warden/src/exec/proc.test.ts
//
// Two properties of the runner that had no test until the psql plans landed,
// and both are the kind that pass by not being exercised.
//
// ⚠️ These are deliberately the NON-SPAWNING parts. Nothing here starts a child
// process: describePlan is pure, and runPsql's two pre-flight refusals happen
// before execFile is reached. A test that actually ran psql would measure the
// machine it ran on, not this module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, psqlPlan, runPsql } from './proc.js';

// ── display quoting ─────────────────────────────────────────────────────────

test("describePlan's display quoting produces POSIX '\\'' — not the ''' that shipped", () => {
  // 🚨 THE BUG THIS PINS, AND IT WAS LIVE: quoteForDisplay's inner escape was
  // written as the template literal `'\''`, in which \' is simply ' — so it
  // emitted ''' instead of '\''. It never fired because no safe-list argv had
  // ever contained a single quote; the psql statements are the first that do,
  // and they are full of them. An operator pasting the describe into a shell
  // would have got a different statement, or none.
  const plan = { kind: 'argv' as const, file: 'psql', argv: ["select 'a'"], timeoutMs: 1 };
  assert.equal(describePlan(plan), "psql 'select '\\''a'\\'''");
  // And explicitly NOT what the broken escape produced, so the pin names the
  // bug rather than only the fix. ⚠️ Do not reach for a `.includes("'''")`
  // check here: the correct output legitimately ends '\''' — the escape's
  // closing quote followed by the wrapper's — so that assertion fails on
  // correct output. (It did, when this test was first written.)
  assert.notEqual(describePlan(plan), "psql 'select '''a''''");
});

test('an argv element needing no quoting is left exactly as it is', () => {
  // The other half of the branch. Without this, "always quote everything" would
  // pass the test above while making every existing describe unrecognisable —
  // and those are the strings the approve-time compare-and-swap matches on.
  const plan = { kind: 'argv' as const, file: 'pm2', argv: ['reload', 'alloutdoor-backend', '--update-env'], timeoutMs: 1 };
  assert.equal(describePlan(plan), 'pm2 reload alloutdoor-backend --update-env');
});

// ── psqlPlan ────────────────────────────────────────────────────────────────

test('psqlPlan is a node plan whose describe is the psql argv, statement included', () => {
  // ⚠️ It is a `node` plan ONLY because the password has to reach psql through
  // the child's environment and ExecPlan has no env channel. Everything else
  // about it must behave like an argv plan — in particular, the describe is
  // derived from the argv psql actually receives rather than hand-written, so
  // it cannot drift from what runs.
  const plan = psqlPlan('select 1', 1_000);
  assert.equal(plan.kind, 'node');
  assert.equal(plan.kind === 'node' && plan.describe, "psql -X -A -t -q -v ON_ERROR_STOP=1 -c 'select 1'");
  assert.notEqual(plan.kind, 'shell', 'a psql plan must never be reachable as a shell plan');
});

test('runPsql answers a missing or unparseable DATABASE_URL with exit 1, never a throw and never a silent success', () => {
  // ⚠️ "nothing matched" and "we never connected" must not read the same in the
  // thread. Both cases below happen before execFile, so this spawns nothing.
  const saved = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    return runPsql('select 1', 1_000)
      .then((missing) => {
        assert.equal(missing.exitCode, 1);
        assert.match(missing.stderr, /DATABASE_URL is not set/);
        assert.equal(missing.stdout, '');
        process.env.DATABASE_URL = 'not a url';
        return runPsql('select 1', 1_000);
      })
      .then((bad) => {
        assert.equal(bad.exitCode, 1);
        assert.match(bad.stderr, /not a parseable URL/);
      })
      .finally(() => {
        if (saved === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = saved;
      });
  } catch (err) {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    throw err;
  }
});
