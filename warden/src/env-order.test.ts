// 🚨 THE .ENV ORDERING. Two review findings, one root cause: modules read
// process.env at TOP LEVEL, and ESM evaluates every static import before the
// importing module's first line — so loadDotEnvFile() as the first statement
// of main() had already missed them. Four documented overrides were silently
// dead (ANTHROPIC_MODEL_WARDEN, ANTHROPIC_MODEL_JUDGE, WARDEN_MODEL_TIMEOUT_MS
// and, worst, WARDEN_APP_ROOT — while ecosystem.config.cjs ships no env block
// and names this .env as the delivery path).
//
// The fix is src/boot.ts: its only static import is the loader, and the app
// tree comes in dynamically afterwards. These tests hold that in place from
// two directions — the runtime behaviour, and the shape of boot.ts itself,
// because the runtime test would still pass if someone made boot.ts static
// AND the .env happened to be absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFile } from './env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, '__fixtures__', 'env-order-probe.ts');
const TSX_CLI = path.join(HERE, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Run the probe in a child — ESM freezes safe-list.ts's APP_ROOT on first
 *  evaluation, so one process cannot observe both orderings. */
function probe(mode: 'after' | 'before', envFile: string): string {
  // node against tsx's own CLI, not npx and not a shell. shell:true passes
  // args unescaped (deprecated, and this call interpolates a temp path), while
  // execFile of npx.cmd fails outright on Windows — a .cmd is not an
  // executable. This form is plain node either way.
  const out = execFileSync(process.execPath, [TSX_CLI, PROBE, mode], {
    cwd: path.join(HERE, '..'),
    env: { ...process.env, WARDEN_ENV_FILE: envFile, WARDEN_APP_ROOT: '' },
    encoding: 'utf8',
  });
  const line = out.split('\n').find((l) => l.startsWith('RESOLVED:'));
  assert.ok(line, `probe printed no RESOLVED line. Output:\n${out}`);
  return line.slice('RESOLVED:'.length).trim();
}

function withEnvFile(body: (envFile: string, root: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'warden-env-'));
  try {
    const root = path.join(dir, 'fake-root').split(path.sep).join('/');
    const envFile = path.join(dir, '.env');
    writeFileSync(envFile, `WARDEN_APP_ROOT=${root}\n`, 'utf8');
    body(envFile, root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── the runtime property ─────────────────────────────────────────────────

test('WARDEN_APP_ROOT from a .env file reaches the safe list when env loads first', () => {
  withEnvFile((envFile, root) => {
    assert.equal(probe('after', envFile), `${root}/warden-archive`);
  });
});

test('…and is silently ignored when the app tree is imported first — the bug boot.ts prevents', () => {
  // This is the assertion that makes the one above meaningful: it pins the
  // OLD behaviour, so the pair proves the ordering is what decides it rather
  // than the .env file merely being readable.
  withEnvFile((envFile) => {
    assert.equal(probe('before', envFile), '/home/alloutdoor/app/warden-archive');
  });
});

// ── the shape of boot.ts, which is what actually guarantees it ────────────

test('boot.ts statically imports ONLY the env loader', () => {
  const src = readFileSync(path.join(HERE, 'boot.ts'), 'utf8');
  const statics = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(
    statics,
    ['./env.js'],
    'a static import of anything else in boot.ts evaluates that module before the .env is read',
  );
});

test('boot.ts reaches the composition root dynamically', () => {
  const src = readFileSync(path.join(HERE, 'boot.ts'), 'utf8');
  assert.match(src, /await import\('\.\/index\.js'\)/);
});

test('pm2 starts boot.js, not index.js', () => {
  // Pointing this back at index.js reinstates the dead overrides with no
  // error anywhere — the ordering is only real if the process entry uses it.
  const eco = readFileSync(path.join(HERE, '..', 'ecosystem.config.cjs'), 'utf8');
  assert.match(eco, /script:\s*'dist\/boot\.js'/);
});

// ── the loader's own contract ────────────────────────────────────────────

test('the loader fills a gap but never overrides a value already in the environment', () => {
  withEnvFile((envFile) => {
    const saved = { file: process.env.WARDEN_ENV_FILE, root: process.env.WARDEN_APP_ROOT };
    try {
      process.env.WARDEN_ENV_FILE = envFile;
      process.env.WARDEN_APP_ROOT = '/set/by/pm2';
      loadDotEnvFile();
      assert.equal(
        process.env.WARDEN_APP_ROOT,
        '/set/by/pm2',
        'a file on disk fills gaps; it does not win arguments with the real environment',
      );
    } finally {
      if (saved.file === undefined) delete process.env.WARDEN_ENV_FILE;
      else process.env.WARDEN_ENV_FILE = saved.file;
      if (saved.root === undefined) delete process.env.WARDEN_APP_ROOT;
      else process.env.WARDEN_APP_ROOT = saved.root;
    }
  });
});

test('a missing .env file is not an error — env may be supplied another way', () => {
  const saved = process.env.WARDEN_ENV_FILE;
  try {
    process.env.WARDEN_ENV_FILE = path.join(tmpdir(), 'warden-does-not-exist-9e3f1c.env');
    assert.doesNotThrow(() => loadDotEnvFile());
  } finally {
    if (saved === undefined) delete process.env.WARDEN_ENV_FILE;
    else process.env.WARDEN_ENV_FILE = saved;
  }
});
