// STRUCTURAL: this directory cannot execute anything, and cannot reach the
// write path.
//
// 🚨 WHY IT EXISTS SEPARATELY FROM diagnose.test.ts's SCAN. That scan is
// `fs.readdirSync(path.dirname(fileURLToPath(import.meta.url)))` — NON
// -RECURSIVE, and rooted in src/diagnose/. It does not see src/agent/ and
// never would. A new directory could import child_process, call
// runSafeListOperation and build a shell plan while 288 tests stayed green.
// That is not hypothetical either: exec/safe-list.test.ts's sudoers derivation
// was blind to a `node` plan reaching sudo from inside run(), and passed 29/29
// while the gap was open.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE THE SCAN. The files in this directory
// explain at length what they deliberately do NOT do, and they name the
// functions they do not call. Scan the prose and the prose trips its own test
// — which has already happened in this repo. Stripping is what makes the scan
// about the CODE.
//
// A grep is a poor test in general. Here it is the right one, for the same
// reason diagnose.test.ts gives: the thing being guarded is the ABSENCE of a
// call, and the consequence of one appearing is not a failing assertion
// somewhere else — it is a model-shaped path to a shell on a production box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(): { name: string; code: string }[] {
  return fs
    .readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((name) => ({ name, code: stripComments(fs.readFileSync(path.join(HERE, name), 'utf8')) }));
}

/** Strips /* … *​/ blocks and whole-line // comments — the same function
 *  diagnose.test.ts uses, for the same reason. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('the scan actually reads this directory\'s source, and there is something to read', () => {
  // ⚠️ A scan that found no files would pass every assertion below. The
  // safe-list lesson: a derivation blind to the shape it guards passes for the
  // wrong reason.
  const files = sourceFiles().map((f) => f.name).sort();
  assert.deepEqual(files, ['detector.ts', 'index.ts', 'loop.ts', 'prompt-tools.ts', 'read-list.ts', 'runner.ts', 'sdk.ts', 'types.ts']);
  for (const { name, code } of sourceFiles()) assert.ok(code.trim().length > 0, `${name} stripped to nothing`);
});

test('no file in the agent layer spawns a subprocess', () => {
  // The agent layer adds ZERO spawn sites to a package whose own exec/proc.ts
  // already admits to having two. Every read goes through CheckContext, whose
  // run() is execFile with an argv ARRAY (src/proc.ts) and whose queryDb()
  // puts the password in the child's environment rather than argv.
  const banned = ['child_process', 'execFile', 'spawn(', 'execSync', 'exec('];
  for (const { name, code } of sourceFiles()) {
    for (const token of banned) {
      assert.equal(code.includes(token), false, `${name} references ${token} — the agent layer must ask CheckContext, never spawn`);
    }
  }
});

test('no file in the agent layer reaches either executor entry point', () => {
  // runSafeListOperation() and runApprovedProposal() are the WRITE path. They
  // write audit records shaped for a write — a trigger, an operator id, a
  // reversibility claim — and routing a read through them would put rows in
  // the audit store describing executions that changed nothing.
  const banned = ['runSafeListOperation', 'runApprovedProposal', 'runApprovedCommand', 'SAFE_LIST', 'runPlan', 'psqlPlan', 'runPsql'];
  for (const { name, code } of sourceFiles()) {
    for (const token of banned) {
      assert.equal(code.includes(token), false, `${name} references ${token} — a read must not borrow the write path`);
    }
  }
});

test('no file in the agent layer can build a shell plan', () => {
  // ReadPlan has no `shell` arm. ExecPlan does, and only
  // executor.runApprovedProposal() may build one — a command an operator
  // personally read, byte for byte, in the Desk's money-grade confirm.
  for (const { name, code } of sourceFiles()) {
    assert.equal(code.includes("'shell'"), false, `${name} names the shell plan kind`);
    assert.equal(code.includes('"shell"'), false, `${name} names the shell plan kind`);
    assert.equal(code.includes('/bin/sh'), false, `${name} names a shell binary`);
  }
});

test('no file in the agent layer reads a path, a filesystem or an environment of its own', () => {
  // Everything the box looks like reaches this layer through CheckContext, so
  // a test can hand it a fake world. A direct fs or path read here would be a
  // second door, and a second door is a door the fake world cannot close.
  // ⚠️ sdk.ts is the ONE exception for process.env, and only for the three
  // names the model call needs — it is the file that owns the credential.
  for (const { name, code } of sourceFiles()) {
    assert.equal(code.includes("from 'node:fs'"), false, `${name} imports node:fs`);
    assert.equal(code.includes("from 'node:path'"), false, `${name} imports node:path`);
    if (name === 'sdk.ts') continue;
    assert.equal(code.includes('process.env'), false, `${name} reads process.env — only sdk.ts may`);
  }
});

test('no Claude request in this layer carries a sampling parameter', () => {
  // temperature/top_p/top_k were removed from the API on the models this repo
  // runs. Sending one returns a 400 that every caller swallows — on
  // 2026-08-19 that left four features silently doing nothing for two days.
  // diagnose.test.ts guards src/diagnose/; this package's other model caller
  // lives here and is not covered by it.
  for (const { name, code } of sourceFiles()) {
    for (const banned of ['temperature', 'top_p', 'top_k']) {
      assert.equal(code.includes(banned), false, `${name} sets ${banned} on a Claude request`);
    }
  }
});

test('the SDK is known to exactly one file', () => {
  // Everything else speaks the small types in types.ts, which is what lets
  // every other test in this directory run with no key, no network and no SDK
  // in the process.
  const importers = sourceFiles().filter((f) => f.code.includes('@anthropic-ai/sdk')).map((f) => f.name);
  assert.deepEqual(importers, ['sdk.ts']);
});

test('the credential is never logged, returned or put in a message', () => {
  for (const { name, code } of sourceFiles()) {
    assert.equal(/console\.(log|error|warn|info)/.test(code), false, `${name} logs — nothing here may write to stdout`);
  }
  const sdk = sourceFiles().find((f) => f.name === 'sdk.ts')!.code;
  // The key is read once, handed to the client, and never touched again.
  assert.equal(sdk.split('ANTHROPIC_API_KEY').length - 1, 1, 'the key name appears more than once in sdk.ts');
  assert.ok(sdk.includes('safeErrorText'), 'the error path must go through the redacting formatter');
});
