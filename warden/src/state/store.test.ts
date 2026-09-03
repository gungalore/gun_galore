// warden/src/state/store.test.ts
//
// What Warden remembers, and the three ways remembering it wrong is silent:
// a thread window taken from the wrong end, a pending proposal trimmed away,
// and a fault re-raised every sweep until the board is unreadable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WardenStore, WIRE_MESSAGE_LIMIT, WIRE_PROPOSAL_LIMIT, faultKeyFor } from './store.js';
import { note } from './messages.js';
import type { DraftedProposal } from '../diagnose/index.js';

const AT = '2026-09-03T08:00:00.000Z';

function memoryStore(): WardenStore {
  return new WardenStore({ filePath: null, now: () => new Date(AT) });
}

let seq = 0;
function drafted(over: Partial<DraftedProposal> = {}): DraftedProposal {
  seq += 1;
  return {
    id: `prop_${seq}`,
    kind: 'proposal',
    status: 'pending',
    headline: 'Restart the backend',
    diagnosis: 'It is wedged.',
    command: 'pm2 reload alloutdoor-backend --update-env',
    gateKey: null,
    raisedAt: AT,
    operation: { name: 'restartProcess', args: { process: 'alloutdoor-backend' } },
    reversible: true,
    checkIds: ['pm2-processes'],
    ...over,
  };
}

async function tmpFile(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warden-store-'));
  return path.join(dir, name);
}

// ── the window, and which end it is taken from ──────────────────────────

test('snapshot sends the NEWEST messages, not the oldest — the backend keeps the FIRST 200 it receives', async () => {
  const store = memoryStore();
  for (let i = 0; i < WIRE_MESSAGE_LIMIT + 50; i += 1) {
    await store.appendMessages([note(AT, [`line ${i}`])]);
  }
  const snap = store.snapshot();
  assert.equal(snap.messages.length, WIRE_MESSAGE_LIMIT);
  // If this ever slices from the front, the Desk shows a thread frozen at
  // whatever Warden was saying days ago, with no error anywhere.
  assert.equal(snap.messages.at(-1)!.body[0], `line ${WIRE_MESSAGE_LIMIT + 49}`);
  assert.equal(snap.messages[0]!.body[0], `line ${50}`);
});

test('snapshot puts PENDING proposals first, so the far side\'s first-50 cap can never cut an actionable one', async () => {
  const store = memoryStore();
  // Fill past the cap with settled proposals raised LATER than the pending one,
  // so only the ordering rule can save it.
  const old = await store.raise(drafted({ raisedAt: '2026-09-01T00:00:00.000Z' }));
  assert.ok(old);
  for (let i = 0; i < WIRE_PROPOSAL_LIMIT + 10; i += 1) {
    const p = await store.raise(drafted({ command: `cmd ${i}`, raisedAt: '2026-09-02T00:00:00.000Z' }));
    assert.ok(p);
    await store.settle(p.id, 'declined', { operatorId: 'admin', reason: null });
  }
  const snap = store.snapshot();
  assert.equal(snap.proposals.length, WIRE_PROPOSAL_LIMIT);
  assert.equal(snap.proposals[0]!.id, old.id, 'the one pending proposal must be first in the array');
});

// ── raising the same fault twice ────────────────────────────────────────

test('an open proposal for the same fault is touched, not duplicated — raise returns null so the announcement is dropped too', async () => {
  const store = memoryStore();
  assert.ok(await store.raise(drafted()));
  assert.equal(await store.raise(drafted()), null, 'the same command is the same fault');
  assert.equal(store.openProposals().length, 1);
});

test('a fault that comes BACK after being settled is raised again — dedupe is against open proposals only', async () => {
  const store = memoryStore();
  const first = await store.raise(drafted());
  assert.ok(first);
  await store.settle(first.id, 'declined', { operatorId: 'admin' });
  assert.ok(await store.raise(drafted()), 'a declined proposal must not silence the fault forever');
});

test('fault identity is the command, not the headline — a reworded finding is the same fault', () => {
  const a = faultKeyFor({ kind: 'proposal', gateKey: null, command: 'pm2 reload x', headline: 'Restart it' });
  const b = faultKeyFor({ kind: 'proposal', gateKey: null, command: 'pm2 reload x', headline: 'The backend is wedged' });
  const c = faultKeyFor({ kind: 'proposal', gateKey: null, command: 'pm2 reload y', headline: 'Restart it' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('red gates are identified by their gate key, so the same standing fact is one row forever', () => {
  const a = faultKeyFor({ kind: 'red_gate', gateKey: 'BACKUP_SET_CIP', command: null, headline: 'CIP sheets are not backed up' });
  const b = faultKeyFor({ kind: 'red_gate', gateKey: 'BACKUP_SET_CIP', command: null, headline: 'Nothing backs up /home/alloutdoor/data/cip' });
  assert.equal(a, b);
});

test('a red gate cannot be stored carrying a command, even if one is drafted for it', async () => {
  const store = memoryStore();
  const p = await store.raise(drafted({ kind: 'red_gate', command: 'rm -rf /', operation: null }));
  assert.ok(p);
  assert.equal(p.command, null);
  assert.equal(p.operation, null);
});

// ── trimming ────────────────────────────────────────────────────────────

test('trimming never drops a PENDING proposal — a decision the operator has not made must not disappear to satisfy a cap', async () => {
  const store = memoryStore();
  const pending: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    const p = await store.raise(drafted({ command: `pending ${i}`, raisedAt: '2026-09-01T00:00:00.000Z' }));
    assert.ok(p);
    pending.push(p.id);
  }
  for (let i = 0; i < 400; i += 1) {
    const p = await store.raise(drafted({ command: `settled ${i}`, raisedAt: '2026-09-02T00:00:00.000Z' }));
    assert.ok(p);
    await store.settle(p.id, 'acknowledged', { operatorId: null });
  }
  for (const id of pending) assert.ok(store.getProposal(id), `pending proposal ${id} was trimmed away`);
});

// ── persistence ─────────────────────────────────────────────────────────

test('the thread, the proposals, the standing instructions and the statuses all survive a restart', async () => {
  const file = await tmpFile('state.json');
  const first = new WardenStore({ filePath: file, now: () => new Date(AT) });
  assert.deepEqual(await first.load(), { ok: true }, 'a missing file is the normal first boot, not an error');

  await first.appendMessages([note(AT, ['the box is fine'])]);
  const raised = await first.raise(drafted());
  assert.ok(raised);
  await first.addStanding('never raise the VerifyNow balance', 'admin', 'operator');
  await first.setStatuses({ 'host-disk': 'warn' });
  await first.setLastCheckAt(AT);

  const second = new WardenStore({ filePath: file });
  assert.deepEqual(await second.load(), { ok: true });
  const snap = second.snapshot();
  assert.equal(snap.lastCheckAt, AT);
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.proposals[0]!.id, raised.id);
  assert.equal(second.standingInstructions()[0]!.text, 'never raise the VerifyNow balance');
  // Without this, a restart re-announces every existing fault as though it had
  // just happened.
  assert.equal(second.lastStatus('host-disk'), 'warn');
});

test('a corrupt state file loads as an empty thread AND says so — an empty thread and a lost one must not look the same', async () => {
  const file = await tmpFile('state.json');
  await fs.writeFile(file, '{ this is not json', 'utf8');
  const store = new WardenStore({ filePath: file });
  const loaded = await store.load();
  assert.equal(loaded.ok, false);
  assert.match((loaded as { reason: string }).reason, /not readable JSON/);
  assert.deepEqual(store.snapshot().messages, []);
});

test('the state file is written atomically — a reader never sees a half-written file', async () => {
  const file = await tmpFile('state.json');
  const store = new WardenStore({ filePath: file });
  await store.load();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.appendMessages([note(AT, [`m${i}`])])));
  // Whatever interleaving happened, what is on disk parses.
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { messages: unknown[] };
  assert.equal(parsed.messages.length, 20);
  assert.equal((await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('a store that cannot write keeps serving, and reports the failure rather than swallowing it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warden-store-'));
  // A path whose parent is a FILE: mkdir and writeFile both fail.
  const blocker = path.join(dir, 'blocker');
  await fs.writeFile(blocker, 'x', 'utf8');
  const errors: string[] = [];
  const store = new WardenStore({ filePath: path.join(blocker, 'state.json'), onPersistError: (e) => errors.push(e) });
  await store.load();
  await store.appendMessages([note(AT, ['still measured, just not remembered'])]);
  assert.equal(store.snapshot().messages.length, 1, 'the daemon must keep working without its file');
  assert.ok(errors.length > 0, 'and it must say that it could not write');
});

// ── settling ────────────────────────────────────────────────────────────

test('reopen puts an approved proposal back only if it is still approved — it never resurrects a declined one', async () => {
  const store = memoryStore();
  const a = await store.raise(drafted({ command: 'a' }));
  const b = await store.raise(drafted({ command: 'b' }));
  assert.ok(a && b);
  await store.settle(a.id, 'approved', { operatorId: 'admin' });
  await store.settle(b.id, 'declined', { operatorId: 'admin', reason: 'no' });
  await store.reopen(a.id);
  await store.reopen(b.id);
  assert.equal(store.getProposal(a.id)!.status, 'pending');
  assert.equal(store.getProposal(b.id)!.status, 'declined');
});

test('standing instructions can be removed by the number the operator was shown — a list nobody can clear stops meaning anything', async () => {
  const store = memoryStore();
  await store.addStanding('one', 'admin', 'operator');
  await store.addStanding('two', 'admin', 'decline');
  assert.equal((await store.removeStanding(1))!.text, 'one');
  assert.equal(store.standingInstructions().length, 1);
  assert.equal(await store.removeStanding(9), null);
  assert.equal(await store.removeStanding(0), null);
});
