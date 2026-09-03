// warden/src/exec/audit.test.ts
//
// Redaction and truncation are the last thing that happens before a command's
// output leaves this process for a chat thread, a proposal or a prompt. Each
// test below names the mutation it exists to catch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOutput, redactSecrets, truncateOutput, MAX_OUTPUT_BYTES } from './audit.js';

// Set once for the whole file — node:test gives each file its own process, so
// this cannot leak into another suite.
process.env.WARDEN_TOKEN = 'wtok_9f3c1a77b2e4d508';
process.env.TEST_SHORT_TOKEN = 'abc1234'; // 7 chars: below the blanket-sweep floor
process.env.NODE_ENV = 'production';

test('a sensitively-named env value is redacted by name wherever it appears', () => {
  const { text, redactions } = redactSecrets(`curl -H 'Authorization: ${process.env.WARDEN_TOKEN}' http://127.0.0.1:4599/chat`);
  assert.equal(text.includes('wtok_9f3c1a77b2e4d508'), false);
  assert.match(text, /\[REDACTED:WARDEN_TOKEN\]/);
  assert.equal(redactions.includes('WARDEN_TOKEN'), true);
});

test('a short env value is left alone — blanket-matching it would eat ordinary words', () => {
  const { text, redactions } = redactSecrets('the build ran with abc1234 in the label and NODE_ENV=production');
  assert.match(text, /abc1234/);
  assert.match(text, /NODE_ENV=production/, 'a diagnostic env line is evidence, not a secret');
  assert.deepEqual(redactions, []);
});

test("a Postgres URL loses its password and keeps its user@host — the part that is evidence", () => {
  const { text, redactions } = redactSecrets('could not connect: postgresql://alloutdoor:S3cr3t-p4ss@127.0.0.1:5432/alloutdoor?schema=public');
  assert.equal(text.includes('S3cr3t-p4ss'), false);
  assert.match(text, /postgresql:\/\/alloutdoor:\[REDACTED\]@127\.0\.0\.1:5432/);
  assert.deepEqual(redactions, ['postgres-url-password']);
});

test('secrets whose env name this process never held are still caught by shape', () => {
  const cases: Array<[string, string, string]> = [
    ['anthropic-api-key-shape', 'sk-ant-api03-AbCdEf0123456789xyz', 'auth error for key sk-ant-api03-AbCdEf0123456789xyz'],
    ['bearer-token', 'Bearer eyJhbGciOi.NotAJwtJustLong.Enough1234', 'sent header Bearer eyJhbGciOi.NotAJwtJustLong.Enough1234'],
    ['jwt-shape', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.9dQpXk3lQe', 'session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.9dQpXk3lQe expired'],
    ['env-assignment', 'PGPASSWORD=hunter2hunter2', 'sh -x: PGPASSWORD=hunter2hunter2 pg_dump …'],
  ];
  for (const [label, secret, line] of cases) {
    const { text, redactions } = redactSecrets(line);
    assert.equal(text.includes(secret), false, `${label} leaked: ${text}`);
    assert.equal(redactions.includes(label), true, `${label} did not report itself`);
  }
});

test('redaction carries no state between calls — the nets are module-scope /g regexes', () => {
  // The nets live at module scope and are global, so they hold a lastIndex. Any
  // detection that reads it (a second `.test()`, an `.exec()` loop) makes the
  // second call start matching from the middle of the string and miss the
  // secret. This asserts the property directly rather than the implementation:
  // the same input twice, and a different input in between, must all answer the
  // same as they do alone.
  const line = 'auth failed for sk-ant-api03-AbCdEf0123456789xyz and Bearer abcdefghijklmnop0123';
  const other = 'PGPASSWORD=hunter2hunter2 pg_dump alloutdoor';
  const alone = redactSecrets(line);
  const first = redactSecrets(line);
  redactSecrets(other);
  const afterOther = redactSecrets(line);
  assert.deepEqual(first, alone);
  assert.deepEqual(afterOther, alone);
  assert.equal(alone.text.includes('sk-ant-api03'), false);
});

test('clean output is untouched and reports zero redactions, never an omitted field', () => {
  const { text, redactions } = redactSecrets('[PM2] Applying action reloadProcessId on app [alloutdoor-backend](ids: [ 0 ])');
  assert.equal(text, '[PM2] Applying action reloadProcessId on app [alloutdoor-backend](ids: [ 0 ])');
  assert.deepEqual(redactions, []);
});

// ── truncation ──────────────────────────────────────────────────────────────

test('truncation states that it happened and how much was withheld', () => {
  const long = 'x'.repeat(MAX_OUTPUT_BYTES + 500);
  const out = truncateOutput(long);
  assert.equal(out.truncated, true);
  assert.equal(out.originalBytes, MAX_OUTPUT_BYTES + 500);
  assert.match(out.text, /\[truncated 500 more bytes\]/);
});

test('short output is left exactly as it was, and says it was not truncated', () => {
  const out = truncateOutput('=== backup ok ===');
  assert.deepEqual(out, { text: '=== backup ok ===', truncated: false, originalBytes: 17 });
});

test('truncation does not leave a half-decoded character behind', () => {
  // A multi-byte character straddling the cut decodes to U+FFFD; shipping that
  // into a record the Desk renders verbatim is a bug the operator would have to
  // interpret.
  const out = truncateOutput('a'.repeat(9) + '🔒' + 'b'.repeat(20), 10);
  assert.equal(out.truncated, true);
  assert.equal(out.text.includes('�'), false);
});

test('a secret sitting across the truncation boundary cannot survive as a readable half', () => {
  // ⚠️ THE MUTATION THIS PINS: truncating before redacting. The tail of the key
  // would be cut away, the head would remain, and the head of an API key is
  // still an API key.
  const secret = 'sk-ant-api03-' + 'Z'.repeat(60);
  const padded = 'y'.repeat(40) + secret + 'trailing noise';
  const out = prepareOutput(padded, 50);
  assert.equal(out.text.includes('sk-ant-api03'), false);
  assert.equal(out.redactions.includes('anthropic-api-key-shape'), true);
  assert.equal(out.originalBytes < padded.length, true, 'originalBytes must describe what was actually stored, after redaction');
});

test('prepareOutput always reports its redactions, so an empty list means "checked, nothing found"', () => {
  const out = prepareOutput('df: /dev/vda1 82% /');
  assert.deepEqual(out.redactions, []);
  assert.equal(out.truncated, false);
});
