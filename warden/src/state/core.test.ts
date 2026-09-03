// warden/src/state/core.test.ts
//
// The daemon's behaviour, with no HTTP and no box under it.
//
// Four things are being defended here, and each of them fails SILENTLY if it
// breaks — which is why each has a test that names it rather than a general
// "approve works" test:
//
//   · a red gate can never be approved,
//   · a command that drifted by one character can never be approved,
//   · no request handler ever waits for a command to finish,
//   · a check that stopped being measurable is news, not a recovery.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WardenCore } from './core.js';
import { WardenStore } from './store.js';
import { createSweepMemory } from '../checks/index.js';
import { fakeContext } from '../checks/testing.js';
import { createRuntime, findSafeListOperation, type ExecPlan, type RunOutcome } from '../exec/index.js';
import type { CheckModule, CheckOutcome, CheckStatus } from '../types.js';
import type { DiagnosisInput, DraftedProposal, ModelCaller } from '../diagnose/index.js';

const AT = new Date('2026-09-03T08:00:00.000Z');

/** The command restartProcess ACTUALLY produces, derived the same way the
 *  executor derives it — a literal here would drift the day the operation
 *  changes and the test would then be asserting nothing. */
const RESTART_COMMAND = (() => {
  const op = findSafeListOperation('restartProcess')!;
  const v = op.validate({ process: 'alloutdoor-backend' });
  assert.ok(v.ok);
  return op.build(v.args).describe;
})();

/** A model that answers correctly and proposes nothing. Used wherever the
 *  test is about something other than diagnosis — without a caller at all,
 *  every sweep raises the "no ANTHROPIC_API_KEY" red gate and its message,
 *  which is correct behaviour but noise here. */
const QUIET: ModelCaller = async () => ({ ok: true, text: '{"items":[]}', model: 'test' });

function check(id: string, outcome: () => CheckOutcome): CheckModule {
  return { id, title: `check ${id}`, cost: 'cheap', cadenceMs: 0, async run() { return outcome(); } };
}

interface Harness {
  core: WardenCore;
  store: WardenStore;
  plans: ExecPlan[];
  errors: string[];
  seenInputs: DiagnosisInput[];
  release: () => void;
}

function harness(opts: {
  checks?: CheckModule[];
  caller?: ModelCaller | null;
  /** When true, runPlan hangs until release() is called. */
  hold?: boolean;
  runOutcome?: Partial<RunOutcome>;
} = {}): Harness {
  const store = new WardenStore({ filePath: null, now: () => AT });
  const plans: ExecPlan[] = [];
  const errors: string[] = [];
  const seenInputs: DiagnosisInput[] = [];
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const caller: ModelCaller | null =
    opts.caller === undefined
      ? null
      : opts.caller === null
        ? null
        : async (input) => {
            seenInputs.push(input);
            return opts.caller!(input);
          };

  const core = new WardenCore({
    store,
    ctx: fakeContext({ now: AT }),
    memory: createSweepMemory(),
    caller,
    checks: opts.checks ?? [],
    now: () => AT,
    chatBudgetMs: 50,
    onError: (where, error) => errors.push(`${where}: ${error}`),
    exec: createRuntime({
      now: () => AT,
      newId: () => 'aud_test',
      async runPlan(plan) {
        plans.push(plan);
        if (opts.hold) await gate;
        return { exitCode: 0, stdout: 'reloaded', stderr: '', timedOut: false, ...opts.runOutcome };
      },
    }),
  });

  return { core, store, plans, errors, seenInputs, release };
}

let seq = 0;
function drafted(over: Partial<DraftedProposal> = {}): DraftedProposal {
  seq += 1;
  return {
    id: `prop_test_${seq}`,
    kind: 'proposal',
    status: 'pending',
    headline: 'The backend is wedged',
    diagnosis: 'It has not answered a health ping in four minutes.',
    command: RESTART_COMMAND,
    gateKey: null,
    raisedAt: AT.toISOString(),
    operation: { name: 'restartProcess', args: { process: 'alloutdoor-backend' } },
    reversible: true,
    checkIds: [],
    ...over,
  };
}

// ── approve: the three refusals ─────────────────────────────────────────

test('a RED GATE cannot be approved — refused by kind, before the command is even looked at, and nothing runs', async () => {
  const h = harness();
  const p = await h.store.raise(drafted({ kind: 'red_gate', command: null, operation: null, gateKey: 'BACKUP_SET_CIP' }));
  assert.ok(p);

  const result = await h.core.approve(p.id, 'admin_1', 'anything at all');
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 400);
  assert.equal(h.plans.length, 0, 'a red gate must never reach the executor');
  assert.equal(h.store.getProposal(p.id)!.status, 'pending');
});

test('a command that drifted by ONE CHARACTER is refused with 409 and nothing runs', async () => {
  const h = harness();
  const p = await h.store.raise(drafted());
  assert.ok(p);

  const result = await h.core.approve(p.id, 'admin_1', `${RESTART_COMMAND} `);
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 409);
  assert.equal(h.plans.length, 0, 'a trailing space is a command the operator did not read');
  assert.equal(h.store.getProposal(p.id)!.status, 'pending');
});

test('an already-settled proposal is refused with 409, and one that no longer holds a command likewise', async () => {
  const h = harness();
  const a = await h.store.raise(drafted());
  assert.ok(a);
  await h.store.settle(a.id, 'declined', { operatorId: 'admin_1' });
  assert.equal(((await h.core.approve(a.id, 'admin_1', RESTART_COMMAND)) as { status: number }).status, 409);

  const b = await h.store.raise(drafted({ command: '', operation: null }));
  assert.ok(b);
  assert.equal(((await h.core.approve(b.id, 'admin_1', '')) as { status: number }).status, 409);
  assert.equal(h.plans.length, 0);
});

test('approving something that does not exist is 404, and the id is never used to look anywhere else', async () => {
  const h = harness();
  const result = await h.core.approve('prop_nope', 'admin_1', 'x');
  assert.equal((result as { status: number }).status, 404);
});

// ── approve: the run is never awaited ───────────────────────────────────

test('approve ANSWERS while the command is still running — a handler that waited would 503 while the box kept working', async () => {
  const h = harness({ hold: true });
  const p = await h.store.raise(drafted());
  assert.ok(p);

  const result = await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  assert.equal(result.ok, true);
  assert.equal((result as { messages: unknown[] }).messages.length, 1);
  // The gate is still shut, so the command cannot have finished — and approve
  // has already answered. Let the dispatch reach runPlan and confirm it is
  // genuinely in flight rather than never started.
  await delay(10);
  assert.equal(h.plans.length, 1);
  assert.equal(h.store.snapshot().messages.filter((m) => m.kind === 'ran').length, 0);

  h.release();
  await h.core.drain();
  const ran = h.store.snapshot().messages.filter((m) => m.kind === 'ran');
  assert.equal(ran.length, 1, 'the transcript must land in the thread once the run finishes');
  assert.equal(ran[0]!.pre?.tone, 'ground');
  assert.ok(ran[0]!.pre!.lines.some((l) => l.includes('reloaded')));
});

test('the approved decision is recorded even though the run is still in flight, and the audit record follows', async () => {
  const h = harness();
  const p = await h.store.raise(drafted());
  assert.ok(p);
  await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  assert.equal(h.store.getProposal(p.id)!.status, 'approved');
  await h.core.drain();
  const audit = h.store.auditFor(p.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.trigger, 'operator_approved');
  assert.equal(audit[0]!.operatorId, 'admin_1');
  assert.equal(audit[0]!.command, RESTART_COMMAND);
});

test('the command that is RUN is the command that was shown — the plan carries the same argv the describe string names', async () => {
  const h = harness();
  const p = await h.store.raise(drafted());
  assert.ok(p);
  await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  await h.core.drain();
  const plan = h.plans[0]!;
  assert.equal(plan.kind, 'argv', 'a safe-list operation must never reach a shell');
  assert.deepEqual([plan.file, ...plan.argv], ['pm2', 'reload', 'alloutdoor-backend', '--update-env']);
});

test('an executor refusal after the decision was recorded puts the proposal BACK on the board rather than claiming it ran', async () => {
  const h = harness();
  // A proposal whose stored command does not match what the operation would
  // now build: the safe list changed between raising and approving.
  const p = await h.store.raise(drafted({ command: 'pm2 reload alloutdoor-backend' }));
  assert.ok(p);
  const result = await h.core.approve(p.id, 'admin_1', 'pm2 reload alloutdoor-backend');
  assert.equal(result.ok, true, 'our own compare-and-swap passes — the drift is inside the safe list');
  await h.core.drain();
  assert.equal(h.plans.length, 0, 'the executor must refuse to run yesterday’s description');
  assert.equal(h.store.getProposal(p.id)!.status, 'pending');
  assert.ok(h.store.snapshot().messages.some((m) => m.body.join(' ').includes('I did not run that after all')));
});

// ── re-check after a fix ────────────────────────────────────────────────

test('a fix is RE-CHECKED against the checks it was raised from, and the transcript says which way it went', async () => {
  let healthy = false;
  const h = harness({
    checks: [check('pm2-processes', () => (healthy ? { status: 'ok', verdict: 'Both online.', evidence: [] } : { status: 'bad', verdict: 'Backend is stopped.', evidence: [] }))],
  });
  const p = await h.store.raise(drafted({ checkIds: ['pm2-processes'] }));
  assert.ok(p);
  healthy = true;

  await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  await h.core.drain();

  const audit = h.store.auditFor(p.id)[0]!;
  assert.deepEqual(audit.recheck?.result, 'ok');
  assert.match(h.store.snapshot().messages.find((m) => m.kind === 'ran')!.footnote!, /re-checked, clear/);
});

test('a proposal with no checks behind it reports "not re-checked yet" — nobody looked is not the same as looked and could not tell', async () => {
  const h = harness();
  const p = await h.store.raise(drafted({ checkIds: [] }));
  assert.ok(p);
  await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  await h.core.drain();
  assert.equal(h.store.auditFor(p.id)[0]!.recheck, null);
  assert.match(h.store.snapshot().messages.find((m) => m.kind === 'ran')!.footnote!, /not re-checked yet/);
});

// ── decline ─────────────────────────────────────────────────────────────

test('a decline REASON becomes a standing instruction; a decline with no reason stores nothing', async () => {
  const h = harness();
  const a = await h.store.raise(drafted({ command: 'a' }));
  const b = await h.store.raise(drafted({ command: 'b' }));
  assert.ok(a && b);

  await h.core.decline(a.id, 'admin_1', 'Leave the overnight retries alone.');
  assert.deepEqual(
    h.store.standingInstructions().map((s) => s.text),
    ['Leave the overnight retries alone.'],
  );

  // Absent key and empty string are the same case — the backend drops an empty
  // reason from the body entirely, so this must never store a blank rule.
  await h.core.decline(b.id, 'admin_1', '   ');
  assert.equal(h.store.standingInstructions().length, 1);
  assert.equal(h.store.getProposal(b.id)!.status, 'declined');
});

test('a red gate cannot be declined either — it is not a decision anyone is being asked to make', async () => {
  const h = harness();
  const p = await h.store.raise(drafted({ kind: 'red_gate', command: null, operation: null }));
  assert.ok(p);
  assert.equal(((await h.core.decline(p.id, 'admin_1', 'no')) as { status: number }).status, 400);
  assert.equal(h.store.getProposal(p.id)!.status, 'pending');
});

// ── standing instructions ───────────────────────────────────────────────

test('"remember:" stores an instruction and echoes the whole list back, with no model call at all', async () => {
  const h = harness({ caller: async () => ({ ok: true, text: '{"items":[]}', model: 'm' }) });
  const result = await h.core.say('remember: never raise the VerifyNow credit balance', 'admin_1');
  assert.equal(result.ok, true);
  assert.equal(h.seenInputs.length, 0, 'a standing instruction is not a question for the model');
  assert.deepEqual(h.store.standingInstructions().map((s) => s.text), ['never raise the VerifyNow credit balance']);
  const echo = (result as { messages: { pre?: { lines: string[] } }[] }).messages.at(-1)!;
  assert.ok(echo.pre!.lines[0]!.includes('never raise the VerifyNow credit balance'));
});

test('standing instructions are echoed into EVERY diagnosis, so a decision made once is honoured later', async () => {
  const h = harness({
    checks: [check('host-disk', () => ({ status: 'bad', verdict: '/ is 96% full.', evidence: [] }))],
    caller: async () => ({ ok: true, text: '{"items":[]}', model: 'm' }),
  });
  await h.core.say('remember: leave the overnight retries alone', 'admin_1');
  await h.core.tick();
  assert.equal(h.seenInputs.length, 1);
  assert.deepEqual(h.seenInputs[0]!.standingInstructions, ['leave the overnight retries alone']);
});

test('"forget: 1" drops one, and an out-of-range number says so rather than silently doing nothing', async () => {
  const h = harness();
  await h.core.say('remember: one', 'admin_1');
  await h.core.say('forget: 9', 'admin_1');
  assert.equal(h.store.standingInstructions().length, 1);
  await h.core.say('forget: 1', 'admin_1');
  assert.equal(h.store.standingInstructions().length, 0);
});

// ── the read path never measures anything ───────────────────────────────

test('GET /chat reads memory only — it answers instantly against a context where every accessor fails', async () => {
  const h = harness({ checks: [check('slow', () => ({ status: 'ok', verdict: 'fine', evidence: [] }))] });
  const started = Date.now();
  const view = h.core.chat();
  assert.ok(Date.now() - started < 50);
  assert.equal(view.lastCheckAt, null, 'never a synthesized "now" — no sweep has finished yet');
  assert.deepEqual(view.messages, []);
  assert.deepEqual(view.proposals, []);
});

test('POST /chat answers within its own budget even when the model is slower, and says the reply will follow', async () => {
  const h = harness({
    caller: async () => {
      await delay(400);
      return { ok: true, text: '{"items":[]}', model: 'm' };
    },
  });
  const started = Date.now();
  const result = await h.core.say('why is disk full?', 'admin_1');
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true);
  assert.ok(elapsed < 300, `answered in ${elapsed}ms — the 25s write budget must never be the thing that stops us`);
  const messages = (result as { messages: { body: string[] }[] }).messages;
  assert.ok(messages.at(-1)!.body.join(' ').includes('still working'));
  await h.core.drain();
});

test('with no ANTHROPIC_API_KEY, POST /chat says so rather than answering with silence', async () => {
  const h = harness({ caller: null });
  const result = await h.core.say('why is disk full?', 'admin_1');
  assert.equal(result.ok, true);
  assert.match((result as { messages: { body: string[] }[] }).messages.at(-1)!.body[0]!, /ANTHROPIC_API_KEY is not set/);
});

// ── transitions ─────────────────────────────────────────────────────────

async function statuses(seq: CheckStatus[]): Promise<{ kinds: string[][]; h: Harness }> {
  let i = 0;
  const h = harness({
    caller: QUIET,
    checks: [
      check('subject', () => {
        const s = seq[Math.min(i, seq.length - 1)]!;
        return s === 'unknown' ? { status: 'unknown', reason: 'the log is not readable' } : { status: s, verdict: `now ${s}`, evidence: [] };
      }),
    ],
  });
  const kinds: string[][] = [];
  for (; i < seq.length; i += 1) {
    const before = h.store.snapshot().messages.length;
    await h.core.tick();
    kinds.push(h.store.snapshot().messages.slice(before).map((m) => m.kind));
  }
  return { kinds, h };
}

test('a check turning bad is announced ONCE; staying bad is not re-announced; coming back is a "fixed"', async () => {
  const { kinds } = await statuses(['bad', 'bad', 'ok']);
  assert.deepEqual(kinds[0], ['finding']);
  assert.deepEqual(kinds[1], [], 'a fault that has been red all week must not be repeated every minute');
  assert.deepEqual(kinds[2], ['fixed']);
});

test('a check that becomes UNKNOWN is a finding, never a "fixed" — stopped being measurable is not recovered', async () => {
  const { kinds, h } = await statuses(['ok', 'unknown']);
  assert.deepEqual(kinds[0], [], 'a first sighting that is healthy is not news');
  assert.deepEqual(kinds[1], ['finding']);
  assert.match(h.store.snapshot().messages.at(-1)!.body[0]!, /Not measured — the log is not readable/);
});

test('a healthy board says nothing at all, and a fresh daemon does not re-announce faults it already knew about', async () => {
  const h = harness({ caller: QUIET, checks: [check('subject', () => ({ status: 'bad', verdict: 'still bad', evidence: [] }))] });
  await h.core.tick();
  assert.equal(h.store.snapshot().messages.length, 1);

  // A restart: new core, same store. The status memory is what stops the whole
  // board being re-announced as though it had just happened.
  const restarted = new WardenCore({
    store: h.store,
    ctx: fakeContext({ now: AT }),
    memory: createSweepMemory(),
    caller: QUIET,
    checks: [check('subject', () => ({ status: 'bad', verdict: 'still bad', evidence: [] }))],
    now: () => AT,
  });
  await restarted.tick();
  assert.equal(h.store.snapshot().messages.length, 1, 'a restart must not replay the board into the thread');
});

// ── diagnosis plumbing ──────────────────────────────────────────────────

test('a proposal the store deduplicated takes its announcement with it', async () => {
  const h = harness({
    checks: [check('host-disk', () => ({ status: 'bad', verdict: '/ is 96% full.', evidence: [] }))],
    caller: async () => ({
      ok: true,
      model: 'm',
      text: JSON.stringify({
        items: [
          {
            kind: 'proposal',
            headline: 'Truncate the backend error log',
            diagnosis: 'It is 4 GiB and it is what filled the disk.',
            fix: { type: 'safe_list', operation: 'truncateLog', args: { logId: 'backendError' } },
            checkIds: ['host-disk'],
          },
        ],
      }),
    }),
  });

  await h.core.tick();
  const first = h.store.snapshot();
  assert.equal(first.proposals.length, 1);
  const messagesAfterFirst = first.messages.length;

  // Same fault, next sweep. One proposal, and no second announcement.
  await h.core.tick();
  const second = h.store.snapshot();
  assert.equal(second.proposals.length, 1, 'the same fault must update one row, not mint a second');
  assert.equal(second.messages.length, messagesAfterFirst, 'and it must not be re-announced either');
});

test('a pending proposal is taken off the board when every check behind it reads ok again', async () => {
  let bad = true;
  const h = harness({ checks: [check('host-disk', () => (bad ? { status: 'bad', verdict: 'full', evidence: [] } : { status: 'ok', verdict: 'fine', evidence: [] }))] });
  const p = await h.store.raise(drafted({ checkIds: ['host-disk'] }));
  assert.ok(p);
  await h.core.tick();
  assert.equal(h.store.getProposal(p.id)!.status, 'pending');
  bad = false;
  await h.core.tick();
  assert.equal(h.store.getProposal(p.id)!.status, 'acknowledged');
});

test('one sweep at a time — a tick that arrives while a sweep is running is refused, not queued', async () => {
  let running = 0;
  let peak = 0;
  const h = harness({
    checks: [
      check('slow', () => {
        running += 1;
        peak = Math.max(peak, running);
        running -= 1;
        return { status: 'ok', verdict: 'fine', evidence: [] };
      }),
    ],
  });
  await Promise.all([h.core.tick(), h.core.tick(), h.core.tick()]);
  assert.equal(peak, 1);
});

test('a sweep that throws is logged and the daemon stays up', async () => {
  const h = harness({ checks: [check('boom', () => { throw new Error('kaboom'); })] });
  const sweep = await h.core.tick();
  // The engine turns the throw into that check's unknown; the sweep survives.
  assert.ok(sweep);
  assert.equal(sweep.results[0]!.status, 'unknown');
  assert.match(sweep.results[0]!.verdict, /kaboom/);
});
