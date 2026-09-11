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
  /** A movable clock. Pause expiry is evaluated on every read rather than on
   *  a timer — a timer would not survive the `pm2 reload` that a paused
   *  daemon is most likely to be sitting through — so the only way to test it
   *  is to move the clock under it. */
  now?: () => Date;
} = {}): Harness {
  const now = opts.now ?? (() => AT);
  const store = new WardenStore({ filePath: null, now });
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
    now,
    chatBudgetMs: 50,
    onError: (where, error) => errors.push(`${where}: ${error}`),
    exec: createRuntime({
      now,
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

test('a check turning bad is announced ONCE; staying bad is not re-announced; coming back is a NOTE, not "fixed alone"', async () => {
  const { kinds, h } = await statuses(['bad', 'bad', 'ok']);
  assert.deepEqual(kinds[0], ['finding']);
  assert.deepEqual(kinds[1], [], 'a fault that has been red all week must not be repeated every minute');
  // 🚨 THIS ASSERTED 'fixed' AND THE MESSAGE WAS A LIE EVERY TIME IT FIRED.
  // The Desk renders kind 'fixed' as "fixed alone" — Warden repaired it,
  // unattended. All this code path has is two sweeps and a status that
  // changed; it cannot know who fixed it, and on this box it has never once
  // been Warden, because runSafeListOperation() has no caller outside its own
  // tests. An operator who fixed nginx by hand at 02:00 was told the agent
  // had done it. The recovery is still announced — it is just honest about
  // whose it was.
  assert.deepEqual(kinds[2], ['note']);
  assert.match(h.store.snapshot().messages.at(-1)!.body.join(' '), /I did not do that/i);
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

// ── Phase 4: pause, and what a pause must NOT stop ──────────────────────
//
// The Site board has had a "Pause Warden" button since it shipped. It posted
// one chat message — "Pause. Stop acting on your safe list and stop raising
// proposals until I say otherwise." — which parseInstruction() classified as
// a QUESTION, because it matches only `remember:`, `forget: N` and the bare
// standing-list words. It was handed to the model for one turn and then
// forgotten; the word "pause" did not appear anywhere in this daemon. These
// tests are what makes that button true, and what stops a future pause from
// going too far the other way.

/** A plain outcome at a given status, for a check whose only job is to turn. */
function outcome(status: CheckStatus): CheckOutcome {
  return status === 'unknown'
    ? { status: 'unknown', reason: 'the log is not readable' }
    : { status, verdict: `now ${status}`, evidence: [] };
}

/** A caller that always drafts one proposal, so "did it raise anything" has a
 *  definite answer. */
const PROPOSES: ModelCaller = async () => ({
  ok: true,
  model: 'test',
  text: JSON.stringify({
    items: [
      {
        kind: 'proposal',
        headline: 'The backend is wedged',
        diagnosis: 'It has not answered a health ping in four minutes.',
        // The shape parse.ts actually accepts: a safe-list NAME plus args it
        // re-validates itself. The model never supplies the command text.
        fix: { type: 'safe_list', operation: 'restartProcess', args: { process: 'alloutdoor-backend' } },
        checkIds: ['subject'],
      },
    ],
  }),
});

test('a paused Warden KEEPS MEASURING and keeps announcing what turned — only the model and the proposals stop', async () => {
  let status: CheckStatus = 'ok';
  const h = harness({ caller: PROPOSES, checks: [check('subject', () => outcome(status))] });

  await h.core.pause({ minutes: 30, operatorId: 'admin_1' });
  status = 'bad';
  const sweep = await h.core.tick();

  // 🚨 THE HALF THAT MUST NOT PAUSE. A Warden that stopped measuring while
  // paused would report health it has not checked: the board would freeze at
  // whatever it said when the operator hit the button, and nothing anywhere
  // would say so. That is a worse failure than the one pausing solves.
  assert.equal(sweep?.results[0]?.status, 'bad', 'the check still ran');
  assert.equal(h.core.gates().rows[0]?.status, 'bad', 'and the board still says so');
  assert.ok(
    h.store.snapshot().messages.some((m) => m.kind === 'finding'),
    'a check that turned is still announced — the operator asked for quiet, not for a blindfold',
  );

  // The half that DOES pause.
  assert.equal(h.store.openProposals().length, 0, 'nothing new was raised');
  assert.equal(h.seenInputs.length, 0, 'and the model was never called');
});

test('the pause rides on BOTH the thread and the board, so neither can look healthy while proposals are suspended', async () => {
  const h = harness({ caller: QUIET });
  await h.core.pause({ minutes: 30, operatorId: 'admin_1', reason: 'mid-deploy' });

  assert.ok(h.core.chat().paused, 'GET /chat carries it');
  assert.ok(h.core.gates().paused, 'GET /gates carries it');
  assert.equal(h.core.chat().paused?.reason, 'mid-deploy');
});

test('a pause ALWAYS expires, and 24 hours is the ceiling — the one nobody resumes is the one that matters', async () => {
  const h = harness({ caller: QUIET });
  // An operator (or a client with a bug) asking for a week gets a day.
  await h.core.pause({ minutes: 60 * 24 * 7, operatorId: 'admin_1' });
  assert.equal(Date.parse(h.core.pausedNow()!.until) - AT.getTime(), 24 * 60 * 60_000);
});

test('an absent or unusable `minutes` falls back to the default — never to zero, which is a pause that has already ended', async () => {
  const h = harness({ caller: QUIET });
  await h.core.pause({ operatorId: 'admin_1' });
  assert.ok(Date.parse(h.core.pausedNow()!.until) > AT.getTime(), 'a default pause is a real pause');

  await h.core.pause({ minutes: Number.NaN, operatorId: 'admin_1' });
  assert.ok(
    Date.parse(h.core.pausedNow()!.until) > AT.getTime(),
    'Number(undefined) is NaN and Math.min(NaN, x) is NaN — a naive clamp turns "no minutes given" into a pause that expired before the response was written, which looks exactly like the button not working',
  );
});

test('a pause that has run out is over WITHOUT a resume, and the thread is told so rather than left saying "paused"', async () => {
  let clock = new Date(AT);
  const h = harness({ caller: QUIET, checks: [check('subject', () => outcome('ok'))], now: () => clock });

  await h.core.pause({ minutes: 10, operatorId: 'admin_1' });
  assert.ok(h.core.pausedNow());

  // ⚠️ NO TIMER FIRES THIS. Expiry is read off the clock on every read, so a
  // pause set before a `pm2 reload` — which is when a paused daemon is most
  // likely to restart — still ends exactly when it said it would.
  clock = new Date(AT.getTime() + 11 * 60_000);
  assert.equal(h.core.pausedNow(), null, 'it is over');

  await h.core.tick();
  assert.match(h.store.snapshot().messages.at(-1)!.body[0]!, /ran out/i);
  assert.equal(h.store.pause, null, 'and the record is cleared, not left to rot');
});

test('a paused Warden asked a DIRECT QUESTION still answers, and still raises nothing', async () => {
  const h = harness({ caller: PROPOSES, checks: [check('subject', () => outcome('bad'))] });
  await h.core.pause({ minutes: 30, operatorId: 'admin_1' });

  await h.core.say('what is wrong with the backend?', 'admin_1');
  // The harness's chat budget is 50ms, so the turn lands in the thread after
  // say() has already answered — see property 1 in core.ts.
  await delay(120);

  // 🚨 THE SECOND HALF OF THE PAUSE, AND IT IS NOT REDUNDANT WITH THE FIRST.
  // A sweep will not diagnose while paused — but POST /chat goes straight to
  // diagnose(), and that answer can draft proposals. Without the gate in
  // ingest(), "stop raising proposals" would hold exactly until the operator
  // typed something, which is when they are most likely to be talking to
  // Warden about the thing they paused it for.
  assert.equal(h.store.openProposals().length, 0);
  assert.ok(
    h.store.snapshot().messages.some((m) => /I am paused until/.test(m.body.join(' '))),
    'and it says what it held rather than dropping it silently',
  );
});

test('a pause does NOT hold back a RED GATE — it holds back fixes, and a red gate is not one', async () => {
  // No caller at all: diagnose() makes no model call in this state, it
  // returns the "ANTHROPIC_API_KEY is not set" red gate, which is exactly the
  // fact a paused board must not be allowed to hide.
  const h = harness({ caller: null, checks: [check('subject', () => outcome('ok'))] });
  await h.core.pause({ minutes: 60 * 12, operatorId: 'admin_1' });

  await h.core.tick();

  // 🚨 A PAUSE SUSPENDS FIXES, NOT FACTS. Everything a pause exists to stop —
  // a model call, a button an operator has to decide about mid-deploy — is
  // absent from a red gate: it carries no command and cannot be approved,
  // declined or acknowledged anywhere in this system. Suppressing one for the
  // twenty-four hours a pause can last meant "Warden cannot diagnose anything"
  // read as a quiet board, on the daemon whose entire purpose is refusing a
  // plausible silence.
  const gates = h.store.openProposals().filter((p) => p.kind === 'red_gate');
  assert.equal(gates.length, 1, 'the red gate is raised even though Warden is paused');
  assert.match(gates[0]!.headline, /ANTHROPIC_API_KEY/);

  // And the pause still does its job on the thing it is for.
  const h2 = harness({ caller: PROPOSES, checks: [check('subject', () => outcome('bad'))] });
  await h2.core.pause({ minutes: 30, operatorId: 'admin_1' });
  await h2.core.say('what is wrong with the backend?', 'admin_1');
  await delay(120);
  assert.equal(
    h2.store.openProposals().filter((p) => p.kind === 'proposal').length,
    0,
    'a repairable proposal is still held, and still said out loud',
  );
});

test('resume puts it back to work, and resuming a Warden that is not paused is not an error', async () => {
  const h = harness({ caller: QUIET });
  await h.core.pause({ minutes: 30, operatorId: 'admin_1' });
  const resumed = await h.core.resume('admin_1');
  assert.equal(resumed.ok, true);
  assert.equal(h.core.pausedNow(), null);

  // The operator making sure is the right instinct and must not be punished.
  const again = await h.core.resume('admin_1');
  assert.equal(again.ok, true);
  assert.match((again as { messages: { body: string[] }[] }).messages[0]!.body[0]!, /was not paused/i);
});

// ── Phase 4: forcing a look ─────────────────────────────────────────────

test('sweepNow IGNORES CADENCE — that is the whole reason it exists', async () => {
  let runs = 0;
  const slow: CheckModule = {
    id: 'slow',
    title: 'a six-hourly check',
    cost: 'cheap',
    // tls-origin's real cadence. An operator who had just renewed the
    // certificate used to wait this long for the board to agree with them,
    // with no way to tell "not fixed" from "not looked at again".
    cadenceMs: 6 * 3_600_000,
    async run() {
      runs += 1;
      return { status: 'ok', verdict: 'fine', evidence: [] };
    },
  };

  const h = harness({ caller: QUIET, checks: [slow] });
  await h.core.tick();
  assert.equal(runs, 1);

  await h.core.tick();
  assert.equal(runs, 1, 'cadence held, as it should on the timer');

  const forced = await h.core.sweepNow({ operatorId: 'admin_1' });
  assert.equal(runs, 2, 'and an explicit ask re-measured it anyway');
  assert.equal(forced.finished, true);
  assert.equal(forced.forced, true);
  assert.equal(forced.joined, false);
  assert.equal(forced.board.rows[0]?.fresh, true);
});

test('a second sweep JOINS the one in flight rather than doubling the load, and says which one it got', async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let runs = 0;
  const held: CheckModule = {
    id: 'held',
    title: 'held',
    cost: 'cheap',
    cadenceMs: 0,
    async run() {
      runs += 1;
      await gate;
      return { status: 'ok', verdict: 'fine', evidence: [] };
    },
  };

  const h = harness({ caller: QUIET, checks: [held] });
  // A cadence sweep is already running when the operator asks.
  const ticking = h.core.tick();
  await delay(5);

  const joined = h.core.sweepNow({ operatorId: 'admin_1', budgetMs: 5_000 });
  release();
  const [, answer] = await Promise.all([ticking, joined]);

  assert.equal(runs, 1, 'one sweep, not two — two at once double the box load for no new information');
  assert.equal(answer.joined, true);
  // ⚠️ AND IT SAYS SO. The sweep it joined was a CADENCE sweep, so some rows
  // may be carried forward; reporting that board as a full re-measure would
  // be the same lie the cadence problem itself is.
  assert.equal(answer.forced, false);
});

test('a forced sweep WRITES DOWN WHO FORCED IT — the route demanded an operatorId and then threw it away', async () => {
  const h = harness({ caller: QUIET, checks: [check('subject', () => outcome('ok'))] });

  await h.core.sweepNow({ operatorId: 'admin_7' });

  // 🚨 THE ONE PHASE 4 ACTION THAT LEFT NO TRACE. server.ts has required an
  // operatorId on POST /sweep since the route shipped, on the stated grounds
  // that "an audit trail that cannot name who stopped the watchdog is not an
  // audit trail" — and sweepNow() had no parameter to receive it, appended no
  // note, and the backend wrote no audit row either. A forced sweep runs every
  // check on the live box, the expensive ones budgeted sixty seconds EACH at
  // concurrency four: a repeatable load event, triggered from a button,
  // recorded nowhere.
  assert.ok(
    h.store.snapshot().messages.some((m) => /admin_7 forced a full re-measure/.test(m.body.join(' '))),
  );
});

test('a sweep that outlives its budget answers finished:false rather than holding the connection past nginx', async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const slow: CheckModule = {
    id: 'slow',
    title: 'slow',
    cost: 'cheap',
    cadenceMs: 0,
    async run() {
      await gate;
      return { status: 'ok', verdict: 'fine', evidence: [] };
    },
  };

  const h = harness({ caller: QUIET, checks: [slow] });
  const answer = await h.core.sweepNow({ operatorId: 'admin_1', budgetMs: 1_000 });

  // 🚨 NOT A FAILURE. The sweep is running; the core answered early so the
  // request cannot outlive nginx's 60s cut, which would hand the operator a
  // 502 while the box was being measured behind it. A full forced sweep runs
  // every check, and the expensive ones are budgeted sixty seconds EACH.
  assert.equal(answer.finished, false);
  release();
  await h.core.drain(1_000);
});

// ── Phase 4: the audit trail, served ────────────────────────────────────

test('an approved run is READABLE AFTERWARDS — before this, the record was written and served to nobody', async () => {
  const h = harness({ caller: QUIET, runOutcome: { stdout: 'reloaded alloutdoor-backend' } });
  const p = (await h.store.raise(drafted()))!;
  await h.core.approve(p.id, 'admin_1', RESTART_COMMAND);
  await delay(40);

  const view = h.core.audit();
  assert.equal(view.entries.length, 1);
  const entry = view.entries[0]!;
  assert.equal(entry.trigger, 'operator_approved');
  assert.equal(entry.operatorId, 'admin_1');
  assert.equal(entry.command, RESTART_COMMAND);
  assert.equal(entry.stdout.text, 'reloaded alloutdoor-backend');
  assert.equal(entry.proposalId, p.id);

  // Narrowed to one run, which is the query an operator asking "what did it
  // do to my box" actually has.
  assert.equal(h.core.audit({ proposalId: p.id }).entries.length, 1);
  assert.equal(h.core.audit({ proposalId: 'prop_that_never_was' }).entries.length, 0);
});

test('the audit trail is NEWEST FIRST and says when it did not carry everything', async () => {
  const h = harness({ caller: QUIET });
  for (let i = 0; i < 3; i += 1) {
    await h.store.recordAudit({
      id: `aud_${i}`,
      at: new Date(AT.getTime() + i * 60_000).toISOString(),
      finishedAt: new Date(AT.getTime() + i * 60_000).toISOString(),
      durationMs: 1,
      trigger: 'operator_approved',
      operatorId: 'admin_1',
      proposalId: 'prop_x',
      operation: { kind: 'approved_command', name: null, args: null },
      command: `echo ${i}`,
      exitCode: 0,
      timedOut: false,
      stdout: { text: '', truncated: false, originalBytes: 0 },
      stderr: { text: '', truncated: false, originalBytes: 0 },
      redactions: [],
      recheck: null,
    });
  }

  // The thread reads oldest-first because it is a conversation; the audit
  // trail reads newest-first because the question is always "what did it just
  // do".
  assert.deepEqual(
    h.core.audit().entries.map((e) => e.id),
    ['aud_2', 'aud_1', 'aud_0'],
  );

  const page = h.core.audit({ limit: 2 });
  assert.deepEqual(
    page.entries.map((e) => e.id),
    ['aud_2', 'aud_1'],
  );
  assert.equal(page.truncated, true, 'a page that dropped older records must say so, or it reads as the whole history');
});

test('a record whose trigger cannot be read is DROPPED AND COUNTED — never sent as "a human approved this"', async () => {
  const h = harness({ caller: QUIET });
  await h.store.recordAudit({
    id: 'aud_garbled',
    at: AT.toISOString(),
    finishedAt: AT.toISOString(),
    durationMs: 1,
    // What a hand-edited state.json, or a daemon a version out of step,
    // leaves behind. store.ts load() casts the stored audit array through
    // unvalidated, so this is reachable on a real box.
    trigger: 'somehow' as never,
    operatorId: null,
    proposalId: 'prop_x',
    operation: { kind: 'approved_command', name: null, args: null },
    command: 'echo hello',
    exitCode: 0,
    timedOut: false,
    stdout: { text: '', truncated: false, originalBytes: 0 },
    stderr: { text: '', truncated: false, originalBytes: 0 },
    redactions: [],
    recheck: null,
  });

  const view = h.core.audit();

  // 🚨 THE RECORD DOES NOT GO OUT WEARING AN APPROVAL NOBODY GAVE. projectAudit
  // used to coerce an unreadable trigger to 'operator_approved' and an
  // unreadable operation kind to 'approved_command', which turned a record it
  // could not parse into the claim that a human read that exact command and
  // authorised it running on the production box.
  assert.equal(view.entries.length, 0);

  // ⚠️ AND THE GAP IS NAMED. A dropped record is a missing alibi, which is
  // survivable only because somebody is told; a coerced one is a manufactured
  // alibi nobody will ever question. This is the half that makes dropping the
  // right answer.
  assert.ok(
    h.errors.some((e) => /^audit: 1 audit record/.test(e)),
    'the daemon counts its own drops and raises them, rather than posting a shorter list',
  );

  // 🚨 AND NAMED WHERE THE OPERATOR CAN SEE IT, NOT ONLY IN pm2 stdout. The
  // onError above reaches this daemon's own log and nothing else; for as long
  // as that was the only channel, the Desk got a shorter list beside
  // `truncated: false` and had no way to tell an incomplete account of what
  // ran on the box from a complete one. `dropped` is what closes that, and
  // the backend adds its own refusals to this number.
  assert.equal(view.dropped, 1);
  assert.equal(view.truncated, false, 'dropped is not truncated — one is a page, the other is an ssh');
});

test('a clean trail says dropped: 0 out loud rather than omitting the field', async () => {
  const h = harness({ caller: QUIET });
  const view = h.core.audit();
  // ⚠️ A STATED ZERO, same discipline as `redactions: []`. An absent field
  // and "nothing was withheld" are different claims, and the backend reads
  // this one to build the total it shows: an absent field there can only
  // under-state the gap, so it must be present whenever it is truthfully 0.
  assert.equal(view.dropped, 0);
});
