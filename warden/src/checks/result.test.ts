// 🚨 THE TWO CRITICAL FINDINGS: check evidence reached the diagnosis prompt
// and the Desk chat thread with no secret redaction at all. pm2.ts's own
// comment claimed protection from src/safety/audit.ts's redactor — that file
// is retired, unreachable dead code (see fence.ts's header). The live
// redactor in exec/audit.ts was wired into exactly two call sites, neither of
// which was diagnose/prompt.ts or state/messages.ts.
//
// These tests exercise ev() — the sole constructor every check uses — and
// then follow real values THROUGH to the two places that leaked: a fenced
// prompt fact (checkToFact/buildFactsSection) and a persisted chat message
// (findingMessage). Testing ev() alone would not have caught the original
// bug: ev() worked fine in isolation, the leak was that nothing downstream
// called it, and the downstream tests already in this repo build Evidence
// literals by hand rather than through ev() — which is exactly how the gap
// went unnoticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev } from './result.js';
import { checkToFact } from '../diagnose/prompt.js';
import { fenceBlock } from '../diagnose/fence.js';
import { findingMessage } from '../state/messages.js';
import type { DiagnosedCheck } from '../diagnose/types.js';
import type { CheckResult } from '../types.js';

const ENV_KEYS = ['WARDEN_TOKEN', 'ANTHROPIC_API_KEY', 'PEACH_SECRET'];
let saved: Record<string, string | undefined>;

test.before(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.WARDEN_TOKEN = 'wt_live_9f3ac72e1b8d4c56a01f';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  process.env.PEACH_SECRET = 'peach_whsec_zzzzzzzzzzzzzzzz';
});

test.after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── ev() itself ──────────────────────────────────────────────────────────

test('ev() strips a live env secret out of evidence value', () => {
  const line = `pm2 restart failed: WARDEN_TOKEN=${process.env.WARDEN_TOKEN} rejected by upstream`;
  const e = ev('pm2 crash tail', line);
  assert.ok(!e.value.includes(process.env.WARDEN_TOKEN as string), 'the live token value must not survive');
  // Two nets both fire here — the name-based sweep tags the value, then the
  // env-assignment net matches the whole KEY=value shape and re-wraps it —
  // so the final marker is the generic one, not the name-tagged one. Assert
  // the property (a marker replaced the secret), not which net wrote it.
  assert.match(e.value, /\[REDACTED(:[A-Z0-9_]+)?\]/);
});

test('ev() strips a bearer token even when it names no env var Warden holds', () => {
  // The pattern nets exist for exactly this: a third party's error body
  // carrying a secret under a name this process never declared.
  const e = ev('nginx error tail', 'upstream rejected Bearer aVeryLongOpaqueTokenValue1234567890==');
  assert.doesNotMatch(e.value, /aVeryLongOpaqueTokenValue1234567890/);
});

test('ev() leaves ordinary evidence untouched', () => {
  const e = ev('disk /', '41% used, 22.4 GB free');
  assert.equal(e.value, '41% used, 22.4 GB free');
});

test('ev() does not touch label or from — those are check-authored, never external content', () => {
  process.env.WARDEN_TOKEN = 'wt_live_9f3ac72e1b8d4c56a01f';
  const e = ev('backend-error 1', 'clean line', 'tail -c 5000 /var/log/backend-error.log');
  assert.equal(e.from, 'tail -c 5000 /var/log/backend-error.log');
});

// ── end to end: a real Anthropic-key-shaped secret in a log tail ──────────

const HOSTILE_LINE =
  'FATAL: unhandled rejection — request carried Authorization: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

function checkWithHostileEvidence(): { diagnosed: DiagnosedCheck; result: CheckResult } {
  const evidence = [ev('backend-error 1', HOSTILE_LINE, 'tail -c 5000 /var/log/backend-error.log')];
  const diagnosed: DiagnosedCheck = {
    id: 'pm2.crash-output',
    title: 'pm2 crash output',
    status: 'bad',
    verdict: 'A backend process crashed with an unhandled rejection.',
    evidence,
  };
  const result: CheckResult = {
    id: 'pm2.crash-output',
    title: 'pm2 crash output',
    cost: 'cheap',
    status: 'bad',
    verdict: 'A backend process crashed with an unhandled rejection.',
    evidence,
    reason: null,
    standing: false,
    gateKey: null,
    measuredAt: '2026-09-03T12:00:00.000Z',
    durationMs: 12,
    fresh: true,
  };
  return { diagnosed, result };
}

test('a secret in a crash log cannot reach the diagnosis prompt via checkToFact', () => {
  const { diagnosed } = checkWithHostileEvidence();
  const fact = checkToFact(diagnosed);
  assert.doesNotMatch(
    fact.value,
    /sk-ant-api03-[A-Za-z0-9]+/,
    'the fact handed to buildFactsSection still carries the key shape',
  );
});

test('a secret in a crash log cannot reach the fenced prompt block that actually wraps it', () => {
  // checkToFact() alone proves the fact string is clean; this proves the
  // SAME fact survives fenceBlock — the function prompt.ts actually calls —
  // without the key resurfacing through fence.ts's own (structural-only)
  // sanitisation.
  const { diagnosed } = checkWithHostileEvidence();
  const fact = checkToFact(diagnosed);
  const fenced = fenceBlock(fact.id, fact.source, fact.value);
  assert.doesNotMatch(fenced, /sk-ant-api03-[A-Za-z0-9]+/);
});

test('a secret in a crash log cannot reach the persisted Desk chat message via findingMessage', () => {
  const { result } = checkWithHostileEvidence();
  const message = findingMessage(result, null, '2026-09-03T12:00:01.000Z');
  const rendered = JSON.stringify(message);
  assert.doesNotMatch(rendered, /sk-ant-api03-[A-Za-z0-9]+/);
});

test('a Postgres URL password in evidence cannot reach the chat message either', () => {
  const line = 'db-reachable failed: could not connect to postgres://warden:s3cr3t-pw-91@10.0.0.4:5432/gungalore';
  const evidence = [ev('connection error', line)];
  const result: CheckResult = {
    id: 'db.reachable',
    title: 'Database reachable',
    cost: 'cheap',
    status: 'bad',
    verdict: 'Could not connect.',
    evidence,
    reason: null,
    standing: false,
    gateKey: null,
    measuredAt: '2026-09-03T12:00:00.000Z',
    durationMs: 12,
    fresh: true,
  };
  const message = findingMessage(result, null, '2026-09-03T12:00:01.000Z');
  assert.doesNotMatch(JSON.stringify(message), /s3cr3t-pw-91/);
  // The host and user are useful evidence and stay — only the password nets.
  assert.match(JSON.stringify(message), /10\.0\.0\.4/);
});
