// warden/src/state/messages.test.ts
//
// The wire projection, and the two spellings that are one keystroke apart.
//
// Everything here is testing a SILENT failure. Nothing on either side of the
// wire errors when a message is malformed — the backend's normaliser drops it
// and the operator simply never sees the finding. So each of these asserts on
// a record that would otherwise vanish with no trace anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declinedMessage,
  findingMessage,
  fixedMessage,
  note,
  operatorSaid,
  projectAudit,
  projectMessage,
  projectProposal,
  ranMessage,
  standingList,
  startedMessage,
} from './messages.js';
import type { StoredProposal } from './store.js';
import type { WardenAuditRecord } from '../exec/index.js';
import type { CheckResult, WardenChatMessage } from '../types.js';

const AT = '2026-09-03T08:00:00.000Z';

function message(over: Record<string, unknown> = {}): WardenChatMessage {
  return { id: 'msg_1', role: 'warden', kind: 'note', at: AT, body: ['something'], ...over } as unknown as WardenChatMessage;
}

function proposal(over: Partial<StoredProposal> = {}): StoredProposal {
  return {
    id: 'prop_1',
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
    faultKey: 'x',
    lastSeenAt: AT,
    resolvedAt: null,
    resolvedBy: null,
    declineReason: null,
    ...over,
  };
}

function auditRecord(over: Partial<WardenAuditRecord> = {}): WardenAuditRecord {
  return {
    id: 'aud_1',
    at: AT,
    finishedAt: '2026-09-03T08:00:04.000Z',
    durationMs: 4_000,
    trigger: 'operator_approved',
    operatorId: 'admin_1',
    proposalId: 'prop_1',
    operation: { kind: 'safe_list', name: 'restartProcess', args: { process: 'alloutdoor-backend' } },
    command: 'pm2 reload alloutdoor-backend --update-env',
    exitCode: 0,
    timedOut: false,
    stdout: { text: 'done', truncated: false, originalBytes: 4 },
    stderr: { text: '', truncated: false, originalBytes: 0 },
    redactions: [],
    recheck: null,
    ...over,
  };
}

// ── the two spellings ───────────────────────────────────────────────────

test("a MESSAGE kind of 'red_gate' (underscore) is dropped — it is the PROPOSAL spelling and the far side exact-matches both", () => {
  assert.equal(projectMessage(message({ kind: 'red_gate' })), null);
  // The correct one survives, so this is testing the spelling and not merely
  // that some string is refused.
  assert.equal(projectMessage(message({ kind: 'red-gate' }))?.kind, 'red-gate');
});

test('a message kind outside the six is dropped whole, never coerced to note', () => {
  for (const kind of ['emergency', 'RAN', 'finding ', 'redgate', '']) {
    assert.equal(projectMessage(message({ kind })), null, `kind ${JSON.stringify(kind)} should not survive`);
  }
});

test('all six real kinds survive', () => {
  for (const kind of ['finding', 'fixed', 'red-gate', 'proposal', 'ran', 'note']) {
    assert.equal(projectMessage(message({ kind }))?.kind, kind);
  }
});

// ── the fields that make a message vanish ───────────────────────────────

test('a message with no id, an unparseable timestamp, or a body that filters to nothing is dropped', () => {
  assert.equal(projectMessage(message({ id: '' })), null);
  assert.equal(projectMessage(message({ at: 'yesterday' })), null);
  assert.equal(projectMessage(message({ at: undefined })), null);
  assert.equal(projectMessage(message({ body: [] })), null);
  assert.equal(projectMessage(message({ body: ['', ''] })), null);
  assert.equal(projectMessage(message({ body: 'not an array' })), null);
});

test('role coerces to warden for anything that is not literally "operator"', () => {
  assert.equal(projectMessage(message({ role: 'Operator' }))?.role, 'warden');
  assert.equal(projectMessage(message({ role: 'operator' }))?.role, 'operator');
});

test('a proposalId outside the id charset is stripped, but the message still renders', () => {
  const out = projectMessage(message({ proposalId: 'prop:1/../gates' }));
  assert.ok(out, 'the message itself must survive — losing the finding to fix a link is the wrong trade');
  assert.equal(out.proposalId, undefined);
  assert.equal(projectMessage(message({ proposalId: 'prop_1-a' }))?.proposalId, 'prop_1-a');
});

test('pre is dropped when its lines are empty, and tone defaults to inset for anything but "ground"', () => {
  assert.equal(projectMessage(message({ pre: { tone: 'ground', lines: [] } }))?.pre, undefined);
  assert.equal(projectMessage(message({ pre: { tone: 'GROUND', lines: ['x'] } }))?.pre?.tone, 'inset');
  assert.equal(projectMessage(message({ pre: { tone: 'ground', lines: ['x'] } }))?.pre?.tone, 'ground');
});

test('caps are applied here rather than left to the far side: 12 paragraphs, 40 pre lines, 200-char footnote', () => {
  const out = projectMessage(
    message({
      body: Array.from({ length: 30 }, (_, i) => `p${i}`),
      pre: { tone: 'inset', lines: Array.from({ length: 90 }, (_, i) => `l${i}`) },
      footnote: 'f'.repeat(500),
    }),
  );
  assert.equal(out?.body.length, 12);
  assert.equal(out?.pre?.lines.length, 40);
  assert.equal(out?.footnote?.length, 200);
});

// ── proposals ───────────────────────────────────────────────────────────

test('a red gate never leaves this daemon carrying a command, whatever was stored', () => {
  const out = projectProposal(proposal({ kind: 'red_gate', command: 'rm -rf /' }));
  assert.equal(out?.command, null, 'a red gate with a command is an approvable red gate');
});

test('a proposal whose id is outside the URL charset is dropped rather than sent unreachable', () => {
  for (const id of ['prop:1', 'prop/1', 'prop.1', '', 'p'.repeat(65)]) {
    assert.equal(projectProposal(proposal({ id })), null, `id ${JSON.stringify(id)} should not survive`);
  }
  assert.ok(projectProposal(proposal({ id: 'prop_1-A' })));
});

test('a proposal with an unrecognised kind or status, an empty headline, or a bad raisedAt is dropped', () => {
  assert.equal(projectProposal(proposal({ kind: 'redgate' as StoredProposal['kind'] })), null);
  assert.equal(projectProposal(proposal({ kind: 'red-gate' as StoredProposal['kind'] })), null);
  assert.equal(projectProposal(proposal({ status: 'open' as StoredProposal['status'] })), null);
  assert.equal(projectProposal(proposal({ headline: '' })), null);
  assert.equal(projectProposal(proposal({ raisedAt: 'soon' })), null);
});

test('the wire projection carries no daemon-internal fields', () => {
  const out = projectProposal(proposal());
  assert.ok(out);
  assert.deepEqual(
    Object.keys(out).sort(),
    [
      'command',
      'diagnosis',
      'gateKey',
      'headline',
      'id',
      'kind',
      'operationName',
      'raisedAt',
      'reversible',
      'status',
    ],
  );
});

// ── the two fields the confirm dialog has to have ───────────────────────
//
// 🚨 THESE WERE DROPPED HERE AND THE DESK LIED BECAUSE OF IT. The confirm
// told the operator, for EVERY proposal, that it "runs inside Warden's own
// safe list". That is true only where `operation` is non-null. The frontend
// could not tell the difference because projectProposal() stripped both
// `operation` and `reversible` before the wire, so a model-drafted free-form
// command was described to the operator as enum-bounded.

test('a safe-list-backed proposal puts the operation NAME on the wire — and never the args', () => {
  const out = projectProposal(proposal());
  assert.equal(out?.operationName, 'restartProcess');
  // The args are an executor input. Approve re-resolves and re-validates them
  // from THIS store; a copy in a browser is a copy somebody could post back.
  assert.equal(JSON.stringify(out).includes('alloutdoor-backend'), true, 'the command itself still names the process');
  assert.equal('args' in (out as unknown as Record<string, unknown>), false);
  assert.equal('operation' in (out as unknown as Record<string, unknown>), false);
});

test('a free-form command reaches the wire as operationName null — the LOUDER confirm, not the friendlier one', () => {
  // This is the `approved_command` path: the model wrote the string, nothing
  // named it, nothing validated its shape. null is what makes the dialog say
  // so instead of vouching for a safe list that never saw it.
  const out = projectProposal(proposal({ operation: null, command: 'pm2 flush' }));
  assert.equal(out?.operationName, null);
});

test('an operation whose name is not a string is NOT a safe-list operation', () => {
  // A hand-edited state.json, or a record from a daemon that spelled the
  // field differently. Reading it as safe-list-backed would put the false
  // reassurance back by the back door.
  for (const operation of [
    { args: {} } as unknown as StoredProposal['operation'],
    { name: '', args: {} } as StoredProposal['operation'],
    { name: 42, args: {} } as unknown as StoredProposal['operation'],
  ]) {
    assert.equal(projectProposal(proposal({ operation }))?.operationName, null);
  }
});

test('reversible needs an explicit true — anything else is NOT reversible', () => {
  // Same rule parse.ts applies to the model's own claim. Five safe-list
  // operations are irreversible and cancelLongQuery/terminateIdleInTransaction
  // differ by one Postgres function name inside a 354-character statement, so
  // an unknown reversibility must land on the louder confirm.
  for (const claim of [false, undefined, null, 'true', 1]) {
    assert.equal(
      projectProposal(proposal({ reversible: claim as unknown as boolean }))?.reversible,
      false,
      `reversible should be false for ${JSON.stringify(claim)}`,
    );
  }
  assert.equal(projectProposal(proposal({ reversible: true }))?.reversible, true);
});

test('a red gate carries neither an operation name nor a reversible claim', () => {
  // It has nothing to run, so there is no authority to describe. The queue
  // card renders no buttons for one; what must never happen is a red gate
  // arriving with a safe-list name that reads as approvable.
  const out = projectProposal(proposal({ kind: 'red_gate', command: null, operation: null, reversible: false }));
  assert.equal(out?.operationName, null);
  assert.equal(out?.reversible, false);
});

// ── the builders, round-tripped ─────────────────────────────────────────

test('every message this daemon builds survives its own wire projection', () => {
  const result: CheckResult = {
    id: 'host-disk',
    title: 'Disk',
    cost: 'cheap',
    status: 'bad',
    verdict: '/ is 94% full.',
    evidence: [{ label: 'used', value: '94%', from: 'df -B1' }],
    reason: null,
    standing: false,
    gateKey: null,
    measuredAt: AT,
    durationMs: 12,
    fresh: true,
  };

  const built = [
    findingMessage(result, 'ok', AT),
    fixedMessage({ ...result, status: 'ok', verdict: '/ is 61% full.' }, 'bad', AT, 'unknown'),
    fixedMessage({ ...result, status: 'ok', verdict: '/ is 61% full.' }, 'bad', AT, 'warden'),
    ranMessage(auditRecord(), AT),
    startedMessage(proposal(), AT),
    declinedMessage(proposal(), 'Leave the overnight retries alone.', AT),
    declinedMessage(proposal(), null, AT),
    standingList([{ text: 'never raise the VerifyNow balance', source: 'operator' }], AT, 'Noted.'),
    standingList([], AT, 'Noted.'),
    note(AT, ['a plain note']),
    operatorSaid(AT, 'what is wrong with disk?'),
  ];

  for (const m of built) {
    assert.ok(projectMessage(m), `${m.kind} message did not survive projection: ${JSON.stringify(m)}`);
  }
});

test('a check that turned UNKNOWN is a finding, not a recovery — "stopped being measurable" is news', () => {
  const result: CheckResult = {
    id: 'nginx-error-rate',
    title: 'nginx error rate',
    cost: 'moderate',
    status: 'unknown',
    verdict: 'Not measured — EACCES reading /var/log/nginx/access.log',
    evidence: [],
    reason: 'EACCES reading /var/log/nginx/access.log',
    standing: false,
    gateKey: null,
    measuredAt: AT,
    durationMs: 3,
    fresh: true,
  };
  const m = findingMessage(result, 'ok', AT);
  assert.equal(m.kind, 'finding');
  assert.match(m.body[0]!, /Not measured/);
  assert.match(m.body[0]!, /It was ok before this sweep/);
});

test("a transcript is 'ground' and a start is not — the tone is the only thing separating 'this ran' from 'this would run'", () => {
  assert.equal(ranMessage(auditRecord(), AT).pre?.tone, 'ground');
  const started = startedMessage(proposal(), AT);
  assert.notEqual(started.kind, 'ran', 'a "started" message has no transcript and must not claim to be one');
  assert.equal(started.pre?.tone, 'inset');
});

test('a truncated transcript says so, with the original size — a reader must never wonder if they have it all', () => {
  const m = ranMessage(
    auditRecord({ stdout: { text: 'first half', truncated: true, originalBytes: 900_000 } }),
    AT,
  );
  assert.ok(m.pre!.lines.some((l) => l.includes('900000')), 'the withheld size must be stated');
  assert.ok(m.pre!.lines.some((l) => l.includes('truncated')));
});

test('a transcript names what was redacted, by name, and the count is stated even when nothing fired', () => {
  const named = ranMessage(auditRecord({ redactions: ['WARDEN_TOKEN', 'postgres-url-password'] }), AT);
  assert.match(named.body[0]!, /redacted 2 values from the output \(WARDEN_TOKEN, postgres-url-password\)/);
  assert.doesNotMatch(ranMessage(auditRecord(), AT).body[0]!, /redacted/);
});

test('the footnote distinguishes "not re-checked yet" from a re-check that ran', () => {
  assert.match(ranMessage(auditRecord(), AT).footnote!, /not re-checked yet/);
  assert.match(
    ranMessage(auditRecord({ recheck: { at: AT, result: 'ok', note: 'clear' } }), AT).footnote!,
    /re-checked, clear/,
  );
  assert.match(
    ranMessage(auditRecord({ recheck: { at: AT, result: 'unknown', note: 'could not read it' } }), AT).footnote!,
    /re-checked, could not tell/,
  );
});

// ── "fixed alone" ───────────────────────────────────────────────────────

test('a bad→ok transition is a NOTE that says Warden did not do it, never the "fixed alone" tag', () => {
  const result: CheckResult = {
    id: 'nginx-5xx',
    title: 'nginx 5xx',
    cost: 'cheap',
    status: 'ok',
    verdict: 'No 5xx in the last hour.',
    evidence: [],
    reason: null,
    standing: false,
    gateKey: null,
    measuredAt: AT,
    durationMs: 3,
    fresh: true,
  };

  // 🚨 THE WHOLE POINT. The Desk renders kind 'fixed' as "fixed alone" —
  // meaning Warden repaired it unattended. Every message this function has
  // ever emitted came from comparing two sweeps, which cannot know who fixed
  // anything, and on this box the answer has always been "a human":
  // runSafeListOperation() has no caller outside its own tests. An operator
  // who repaired nginx by hand at 02:00 was told the agent had done it.
  const byNobodyKnown = fixedMessage(result, 'bad', AT, 'unknown');
  assert.equal(byNobodyKnown.kind, 'note');
  assert.match(byNobodyKnown.body.join(' '), /I did not do that/i);

  // The tag survives for the one case that would earn it. Nothing reaches it
  // today; that is the honest state of the unattended path, not a gap.
  const byWarden = fixedMessage(result, 'bad', AT, 'warden');
  assert.equal(byWarden.kind, 'fixed');
  assert.match(byWarden.body.join(' '), /after something I ran/i);
});

// ── the audit trail on the wire ─────────────────────────────────────────

test('an audit record survives projection with its transcript, its redaction names and its recheck intact', () => {
  const wire = projectAudit(
    auditRecord({ redactions: ['WARDEN_TOKEN'], recheck: { at: AT, result: 'ok', note: 'clear' } }),
  );
  assert.ok(wire);
  assert.equal(wire.command, 'pm2 reload alloutdoor-backend --update-env');
  assert.equal(wire.operationKind, 'safe_list');
  assert.equal(wire.operationName, 'restartProcess');
  assert.equal(wire.stdout.text, 'done');
  assert.deepEqual(wire.redactions, ['WARDEN_TOKEN']);
  assert.deepEqual(wire.recheck, { at: AT, result: 'ok', note: 'clear' });
  // ⚠️ The resolved args are NOT on the wire — `command` is built from them
  // by the same describe() the executor runs, so they are already in it.
  assert.equal('operation' in wire, false);
});

test('the second clamp never lies about how much output there was', () => {
  // 20 KB of stdout, as exec/audit.ts would have stored it after redacting
  // and truncating a much larger log.
  const stored = 'x'.repeat(20_000);
  const wire = projectAudit(auditRecord({ stdout: { text: stored, truncated: true, originalBytes: 4_000_000 } }));
  assert.ok(wire);
  assert.ok(wire.stdout.text.length < stored.length, 'the wire copy is clamped again');
  assert.equal(wire.stdout.truncated, true);
  // 🚨 THE HONESTY RULE. originalBytes is the size of the REAL output, not of
  // the stored copy and not of the wire copy. Recomputing it here would
  // report a 4 KB excerpt of a 4 MB log as the whole thing, and a reader
  // would have no way to know they were missing anything.
  assert.equal(wire.stdout.originalBytes, 4_000_000);
});

test('a recheck result the daemon cannot name collapses to null ("nobody looked"), never to "unknown"', () => {
  const wire = projectAudit(
    auditRecord({ recheck: { at: AT, result: 'probably-fine' as never, note: 'x' } }),
  );
  assert.ok(wire);
  // "looked and could not tell" is a claim; "nobody has looked yet" is the
  // truth when the result is unreadable. Collapsing to 'unknown' would be the
  // daemon asserting a re-check that never happened.
  assert.equal(wire.recheck, null);
});

test('an audit record with an unusable proposal id still renders — the RUN is the record, the link is not', () => {
  const wire = projectAudit(auditRecord({ proposalId: 'not a valid id!' }));
  assert.ok(wire, 'a run that happened must not vanish because its link is unfollowable');
  assert.equal(wire.proposalId, '');
});

test('an audit record with no id or an unparseable start time is dropped rather than half-rendered', () => {
  assert.equal(projectAudit(auditRecord({ id: '' })), null);
  assert.equal(projectAudit(auditRecord({ at: 'the other day' })), null);
});

test('an unreadable trigger or operation kind DROPS the record — it is never coerced to "a human approved this"', () => {
  // 🚨 THE ONE THAT MATTERS. Both fields used to fall through a ternary to
  // the STRONGER claim: an unreadable trigger became 'operator_approved' and
  // an unreadable operation.kind became 'approved_command'. A record that
  // could not be read was therefore written into the operator's audit page as
  // a run a human read the exact command of and signed off on. Nothing
  // validates these on the way in — store.ts load() casts the stored audit
  // array straight through — so a hand-edited state.json, or one written by a
  // daemon that spelled the field differently, manufactured the approval.
  assert.equal(projectAudit(auditRecord({ trigger: 'somehow' as never })), null);
  assert.equal(
    projectAudit(auditRecord({ operation: { kind: 'whatever' as never, name: null, args: null } })),
    null,
  );
  // ⚠️ AND IT DEFEATED THE BACKEND'S OWN RULE. warden.service.ts
  // normaliseAuditEntry() drops a record whose trigger it cannot name — a
  // rule that could never fire, because this side had already turned the
  // garbage into a valid literal before it reached the wire.

  // Both real values still survive, so this is testing the refusal and not
  // merely that something is refused.
  assert.equal(projectAudit(auditRecord({ trigger: 'unattended' }))?.trigger, 'unattended');
  assert.equal(
    projectAudit(auditRecord({ operation: { kind: 'approved_command', name: null, args: null } }))?.operationKind,
    'approved_command',
  );
});

test('missing output is empty and says so — never read as "the command printed nothing"', () => {
  const wire = projectAudit(auditRecord({ stdout: undefined as never }));
  assert.ok(wire);
  assert.deepEqual(wire.stdout, { text: '', truncated: false, originalBytes: 0 });
});
