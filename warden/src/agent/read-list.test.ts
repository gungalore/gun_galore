// Tests for the READ LIST — the closed registry and its argument gates.
//
// These are the tests that stand in front of the invariant: there is no code
// path from the model's tokens to an argv that skips validate(), and no path
// to a shell that does not go through an operator reading the exact string.
// Every one of them was BROKEN ON PURPOSE and watched fail before being
// restored; the failure text is in the track's report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeContext, TEST_CONFIG } from '../checks/testing.js';
import { LOG_IDS } from '../exec/index.js';
import {
  DU_DIRS,
  FILE_IDS,
  LS_DIRS,
  NAMED_QUERIES,
  QUERY_IDS,
  READ_COMMANDS,
  READ_LIST,
  TAIL_DEPTHS,
  fileTargets,
  findReadCommand,
  findReadTool,
} from './read-list.js';
import type { ReadPlan } from './types.js';

const deps = { ctx: fakeContext(), checks: [] };

// ── closure ─────────────────────────────────────────────────────────────────

test('the registry is closed: five tools, and a name that is not one of them resolves to nothing', () => {
  assert.equal(READ_LIST.length, 5);
  assert.deepEqual(
    READ_LIST.map((t) => t.name),
    ['read_file', 'tail_log', 'run_read_command', 'query_db', 'recheck_now'],
  );
  for (const miss of ['read_files', 'READ_FILE', 'read_file ', 'write_file', 'exec', '']) {
    assert.equal(findReadTool(miss), null, `"${miss}" must not resolve`);
  }
});

test('tool lookup is EXACT — never prefix, never fuzzy, never case-insensitive', () => {
  // The rule findSafeListOperation states on the write side, for the same
  // reason: a generously-resolved near-match is a different tool than the one
  // whose safety argument was reviewed.
  assert.equal(findReadTool('read'), null);
  assert.equal(findReadTool('Read_File'), null);
  assert.equal(findReadCommand('directory'), null);
  assert.equal(findReadCommand('DirectorySizes'), null);
  assert.notEqual(findReadCommand('directorySizes'), null);
});

// ── no shell, and no argv the model wrote ───────────────────────────────────

test('NO read tool and NO read command can build a shell plan', () => {
  // ReadPlan has no `shell` arm at all — exec/proc.ts's ExecPlan does, and
  // only executor.runApprovedProposal() may build one. This asserts the
  // runtime half, because a `kind` string can be widened by the same edit that
  // widens the type.
  const allowed = new Set(['argv', 'tail', 'file', 'query', 'recheck']);
  const plans: ReadPlan[] = [
    ...FILE_IDS.map((fileId) => build('read_file', { fileId })),
    ...LOG_IDS.map((logId) => build('tail_log', { logId, depth: 'short' })),
    ...DU_DIRS.map((dir) => build('run_read_command', { command: 'directorySizes', args: { dir } })),
    ...LS_DIRS.map((dir) => build('run_read_command', { command: 'listDirectory', args: { dir } })),
    build('run_read_command', { command: 'processTable' }),
    ...QUERY_IDS.map((queryId) => build('query_db', { queryId })),
    build('recheck_now', { checkId: 'host-disk' }),
  ];
  for (const plan of plans) {
    assert.ok(allowed.has(plan.kind), `a read built a "${plan.kind}" plan`);
    assert.notEqual(plan.kind as string, 'shell');
  }
});

test('every argv element of every buildable read comes from this module, never from the caller', () => {
  // The strong form of the invariant: enumerate every reachable plan and
  // assert that no argv element is a value the model could have composed.
  // Each element must be either a literal flag/constant this file wrote or a
  // path resolved through WardenConfig.
  const knownPaths = new Set<string>([
    ...Object.values(fileTargets(TEST_CONFIG)),
    TEST_CONFIG.appRoot,
    TEST_CONFIG.backupDir,
    TEST_CONFIG.secureUploadDir,
    TEST_CONFIG.cipSheetsDir,
    TEST_CONFIG.prismaMigrationsDir,
    TEST_CONFIG.nginxSitesEnabledDir,
    '/var/log',
    `${TEST_CONFIG.appRoot}/frontend/.next/cache`,
    `${TEST_CONFIG.appRoot}/warden-archive`,
  ]);
  const literals = new Set(['-x', '-h', '-d', '1', '-la', '--time-style=long-iso', '-eo', 'pid,ppid,rss,etimes,stat,comm', '--sort=-rss', '-n', '200', '1000', '5000']);

  const argvPlans = [
    ...DU_DIRS.map((dir) => build('run_read_command', { command: 'directorySizes', args: { dir } })),
    ...LS_DIRS.map((dir) => build('run_read_command', { command: 'listDirectory', args: { dir } })),
    build('run_read_command', { command: 'processTable' }),
    ...LOG_IDS.flatMap((logId) => TAIL_DEPTHS.map((depth) => build('tail_log', { logId, depth }))),
  ];

  for (const plan of argvPlans) {
    assert.ok(plan.kind === 'argv' || plan.kind === 'tail');
    if (plan.kind !== 'argv' && plan.kind !== 'tail') continue;
    for (const element of plan.argv) {
      const known = literals.has(element) || knownPaths.has(element) || element.startsWith('/var/log/') || element.endsWith('.log');
      assert.ok(known, `argv element "${element}" in ${plan.file} is not a constant or a config-resolved path`);
    }
  }
});

// ── the prototype-chain hole, reproduced deliberately ───────────────────────

test('__proto__, constructor and toString are refused for every enum argument', () => {
  // The retired src/safety/ copy of the safe list gated on `!(id in LOG_FILES)`
  // and `in` walks the prototype chain, so all three of these validated there
  // while its live twin refused them. requireEnum here is an includes() on a
  // literal tuple; this pins that it stays one.
  for (const evil of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(tool('read_file').validate({ fileId: evil }).ok, false, `read_file accepted ${evil}`);
    assert.equal(tool('tail_log').validate({ logId: evil, depth: 'short' }).ok, false, `tail_log accepted ${evil}`);
    assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: evil }).ok, false, `tail_log accepted depth ${evil}`);
    assert.equal(tool('query_db').validate({ queryId: evil }).ok, false, `query_db accepted ${evil}`);
    assert.equal(tool('run_read_command').validate({ command: evil }).ok, false, `run_read_command accepted ${evil}`);
    assert.equal(
      tool('run_read_command').validate({ command: 'directorySizes', args: { dir: evil } }).ok,
      false,
      `directorySizes accepted ${evil}`,
    );
  }
});

test('an array is refused outright, not read as an object with undefined fields', () => {
  for (const t of READ_LIST) {
    const r = t.validate([]);
    assert.equal(r.ok, false, `${t.name} accepted an array`);
  }
});

test('extra arguments are REFUSED, not ignored', () => {
  assert.equal(tool('read_file').validate({ fileId: 'nginxRepoConf', path: '/etc/shadow' }).ok, false);
  assert.equal(tool('query_db').validate({ queryId: 'tableSizes', sql: 'select 1' }).ok, false);
  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: 'short', path: '/etc/shadow' }).ok, false);
  assert.equal(tool('run_read_command').validate({ command: 'processTable', extra: 1 }).ok, false);
  assert.equal(findReadCommand('processTable')!.validate({ dir: 'appRoot' }).ok, false);
});

test('a refusal names the whole allowed set, so the model is never choosing blind', () => {
  const r = tool('read_file').validate({ fileId: 'nope' });
  assert.equal(r.ok, false);
  if (!r.ok) for (const id of FILE_IDS) assert.ok(r.error.includes(id), `the refusal omits ${id}`);
});

test('validate() never throws, whatever it is handed', () => {
  const nasty: unknown[] = [null, undefined, 0, '', 'string', [], [{}], new Date(), Object.create(null), { toString: () => { throw new Error('x'); } }];
  for (const t of READ_LIST) for (const raw of nasty) assert.doesNotThrow(() => t.validate(raw));
});

// ── read_file: the fileId enum, and what is NOT on it ───────────────────────

test('read_file has no path argument and the env files are NOT reachable through it', () => {
  // 🚨 The load-bearing exclusion. checks/env-manifest.ts is the boundary
  // ("A VALUE NEVER LEAVES THIS CHECK") and redactSecrets() is only a net that
  // sweeps Warden's own three env values — every backend secret is invisible
  // to it. A read_file that could open these paths would walk around the
  // boundary that has kept a secret out of this prompt.
  const targets = Object.values(fileTargets(TEST_CONFIG));
  assert.equal(targets.includes(TEST_CONFIG.backendEnvPath), false, 'backend/.env is reachable through read_file');
  assert.equal(targets.includes(TEST_CONFIG.frontendEnvPath), false, 'frontend/.env.production is reachable through read_file');
  for (const id of FILE_IDS) assert.equal(/\.env/.test(fileTargets(TEST_CONFIG)[id]), false, `${id} resolves to an env file`);

  // And there is no way to ask for one: the only argument is the enum.
  assert.equal(tool('read_file').validate({ fileId: TEST_CONFIG.backendEnvPath }).ok, false);
  assert.equal(tool('read_file').validate({ path: TEST_CONFIG.backendEnvPath }).ok, false);
});

test('read_file paths come from WardenConfig, never from a literal in the module', () => {
  const moved = fileTargets({ ...TEST_CONFIG, appRoot: '/elsewhere', nginxRepoConfPath: '/elsewhere/nginx.conf' });
  assert.equal(moved.nginxRepoConf, '/elsewhere/nginx.conf');
  assert.equal(moved.backendPackageJson, '/elsewhere/backend/package.json');
});

// ── tail_log ────────────────────────────────────────────────────────────────

test('tail_log uses exec/safe-list.ts\'s LOG_IDS verbatim, so read and truncate cannot disagree', () => {
  const schema = tool('tail_log').schema();
  const declared = (schema.properties as Record<string, { enum?: string[] }>).logId.enum ?? [];
  assert.deepEqual(declared, [...LOG_IDS]);
  for (const id of LOG_IDS) assert.equal(tool('tail_log').validate({ logId: id, depth: 'deep' }).ok, true);
});

test('the tail line count is a CONSTANT selected by an enum key — never a number the model sent', () => {
  const plan = build('tail_log', { logId: 'nginxError', depth: 'deep' });
  assert.equal(plan.kind, 'tail');
  if (plan.kind !== 'tail') return;
  assert.deepEqual(plan.argv.slice(0, 2), ['-n', '5000']);
  // A number of its own is refused outright, not clamped: clamping would mean
  // a model-supplied integer reached the argv after arithmetic.
  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: 999 }).ok, false);
  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: '5000' }).ok, false);
  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: 'short', lines: 100000 }).ok, false);
});

test('contains is a plain substring: bounded, control characters stripped, and it never reaches the argv', () => {
  const plan = build('tail_log', { logId: 'nginxError', depth: 'short', contains: 'upstream timed out' });
  assert.equal(plan.kind, 'tail');
  if (plan.kind !== 'tail') return;
  assert.equal(plan.contains, 'upstream timed out');
  // ⚠️ THE POINT: it is NOT in the argv. A grep -F would put it there, and a
  // model-composed argv element is the failure the invariant exists to
  // prevent.
  assert.equal(plan.argv.some((a) => a.includes('upstream')), false);

  // Over-length is CAPPED rather than refused — an over-long substring is a
  // model being verbose, not a model being wrong, and refusing it would cost a
  // turn to say so.
  const capped = build('tail_log', { logId: 'nginxError', depth: 'short', contains: 'x'.repeat(500) });
  assert.equal(capped.kind, 'tail');
  if (capped.kind === 'tail') assert.equal(capped.contains!.length, 80);

  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: 'short', contains: '\n\t ' }).ok, false);
  assert.equal(tool('tail_log').validate({ logId: 'nginxError', depth: 'short', contains: 42 }).ok, false);
});

// ── query_db: named queries only, and no PII ────────────────────────────────

/** Column names and SQL fragments that would mean an application table, a
 *  member, or a credential. ⚠️ Deliberately excludes bare "name": Postgres's
 *  own catalogs are full of relname / schemaname / application_name, and a
 *  denylist that fires on those is a denylist somebody weakens. */
const PII_TOKENS = [
  'idnumber',
  'id_number',
  'email',
  'phone',
  'firstname',
  'lastname',
  'surname',
  'username',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'bankaccount',
  'bank_account',
  'client_addr',
  'address',
  'from "user"',
  'from "listing"',
  'from "transaction"',
  'from "motivation"',
  'from "complaint"',
  'from "message"',
];

test('no named query, by column or by statement, names anything on the PII denylist', () => {
  // 🚨 A free-form SELECT would be an exfiltration channel with a read-only
  // alibi — `select "idNumber", "phone" from "User"` changes nothing and still
  // lands in the thread, the audit store and the next prompt, and
  // redactSecrets() does not know what a South African ID number looks like.
  // There is no SQL argument; this checks the four literals themselves.
  for (const id of QUERY_IDS) {
    const q = NAMED_QUERIES[id];
    const haystack = `${q.sql} ${q.columns.join(' ')}`.toLowerCase();
    for (const token of PII_TOKENS) {
      assert.equal(haystack.includes(token), false, `named query "${id}" names "${token}"`);
    }
  }
});

test('every named query reads a catalog view or _prisma_migrations, declares its columns, and carries a LIMIT', () => {
  for (const id of QUERY_IDS) {
    const q = NAMED_QUERIES[id];
    assert.ok(q.columns.length > 0, `${id} declares no columns`);
    assert.match(q.sql, /\blimit \d+/i, `${id} has no LIMIT`);
    assert.ok(
      /from pg_catalog\./i.test(q.sql) || /from "_prisma_migrations"/.test(q.sql),
      `${id} reads something that is not a catalog view or the migrations table`,
    );
    // pg_stat_activity carries the live statement text; db-long-running
    // already surfaces a bounded slice of it under its own reviewed framing,
    // and widening that to every session would put member-derived literals in
    // the prompt for no gain.
    assert.equal(/\bquery\b/i.test(q.sql), false, `${id} selects the query text`);
  }
});

test('query_db takes a queryId and nothing else — there is no SQL argument and no parameter channel', () => {
  assert.equal(tool('query_db').validate({ sql: 'select 1' }).ok, false);
  assert.equal(tool('query_db').validate({ queryId: 'tableSizes', where: "1=1" }).ok, false);
  const plan = build('query_db', { queryId: 'migrationTail' });
  assert.equal(plan.kind, 'query');
  if (plan.kind === 'query') assert.equal(plan.sql, NAMED_QUERIES.migrationTail.sql);
});

// ── run_read_command ────────────────────────────────────────────────────────

test('run_read_command delegates the inner argument to the command\'s OWN validate, which is the only gate', () => {
  assert.equal(tool('run_read_command').validate({ command: 'directorySizes' }).ok, false);
  assert.equal(tool('run_read_command').validate({ command: 'directorySizes', args: { dir: '/etc' } }).ok, false);
  assert.equal(tool('run_read_command').validate({ command: 'listDirectory', args: { dir: 'secureUploads' } }).ok, false);
  assert.equal(tool('run_read_command').validate({ command: 'directorySizes', args: { dir: 'secureUploads' } }).ok, true);
});

test('the encrypted secure-upload tree may be TOTALLED but never LISTED', () => {
  // Its bytes are unreadable without ID_HASH_SECRET, but its FILENAMES are
  // metadata about members' identity documents. du yields a number; ls yields
  // names.
  assert.ok(DU_DIRS.includes('secureUploads'));
  assert.equal((LS_DIRS as readonly string[]).includes('secureUploads'), false);
});

test('processTable does not print command lines', () => {
  // A command line is where a credential sits in plain sight on a box, and
  // redactSecrets() is a net rather than a boundary. The cost is stated in the
  // operation's own reasoning: every Node process reads as "node".
  const plan = build('run_read_command', { command: 'processTable' });
  assert.equal(plan.kind, 'argv');
  if (plan.kind !== 'argv') return;
  assert.equal(plan.argv.join(' ').includes('args'), false);
  assert.equal(plan.argv.join(' ').includes('command'), false);
});

// ── schemas ─────────────────────────────────────────────────────────────────

test('each tool schema is built from the SAME frozen tuple its validate() checks, so the published enum cannot drift', () => {
  const pairs: Array<[string, string, readonly string[]]> = [
    ['read_file', 'fileId', FILE_IDS],
    ['query_db', 'queryId', QUERY_IDS],
    ['tail_log', 'depth', TAIL_DEPTHS],
  ];
  for (const [name, field, expected] of pairs) {
    const props = tool(name).schema().properties as Record<string, { enum?: string[] }>;
    assert.deepEqual(props[field].enum, [...expected], `${name}.${field} publishes a different set than it validates`);
  }
  const cmd = (tool('run_read_command').schema().properties as Record<string, { enum?: string[] }>).command.enum ?? [];
  assert.deepEqual(cmd, READ_COMMANDS.map((c) => c.name));
});

test('every schema refuses additional properties and names its required fields', () => {
  for (const t of READ_LIST) {
    const s = t.schema();
    assert.equal(s.type, 'object');
    assert.equal(s.additionalProperties, false, `${t.name} allows additional properties`);
    assert.ok((s.required ?? []).length > 0, `${t.name} requires nothing`);
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

function tool(name: string) {
  const t = findReadTool(name);
  assert.ok(t, `no tool named ${name}`);
  return t!;
}

function build(name: string, input: unknown): ReadPlan {
  const t = tool(name);
  const v = t.validate(input);
  assert.ok(v.ok, `${name} refused ${JSON.stringify(input)}: ${v.ok ? '' : v.error}`);
  if (!v.ok) throw new Error('unreachable');
  return t.build(v.args as never, deps);
}
