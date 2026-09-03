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
    ['command', 'diagnosis', 'gateKey', 'headline', 'id', 'kind', 'raisedAt', 'status'],
  );
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
    fixedMessage({ ...result, status: 'ok', verdict: '/ is 61% full.' }, 'bad', AT),
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
