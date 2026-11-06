#!/usr/bin/env node
/**
 * THE PLATFORM FEE — two copies of one schedule, and a gate that refuses to let
 * them drift.
 *
 * `backend/src/payments/fee.calculator.ts` is the money: it computes what the
 * buyer is actually charged. `lib/platform-fee.ts` is the browser's copy, used
 * to DRAW the total before the buyer commits. Because the charge is recomputed
 * server-side, a drifted copy does not throw, does not fail a test and does not
 * stop the sale — the buyer is simply charged a different number than the one
 * on screen. That is the failure this file exists to prevent.
 *
 * ⚠️ WHY A SCRIPT AND NOT A COMMENT. There were five copies of these bands
 * (listing page, both checkout forms, the sell form, the legal table) and every
 * one of them said "keep in sync with fee.calculator.ts" in a comment. They
 * agreed only because the schedule has not moved since 2026-10. A comment is
 * not in the path of the person changing the number; a failing build is. Same
 * reasoning as scripts/theme-sync.cjs, and wired into `npm run build` the same
 * way — there is no CI in this repo, so `next build` is the only gate that
 * actually runs.
 *
 * ⚠️ A SILENTLY-UNMATCHED REGEX IS THE WAY THIS CHECK ROTS. If either file is
 * restructured and a pattern stops matching, this exits 1 and says so rather
 * than reporting "clean" about a file it no longer understands.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.resolve(ROOT, '..', 'backend', 'src', 'payments', 'fee.calculator.ts');
const FRONTEND = path.join(ROOT, 'lib', 'platform-fee.ts');

const problems = [];

function read(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    problems.push(`${label}: cannot read ${path.relative(ROOT, file)} (${err.message})`);
    return null;
  }
}

/** Every `{ limit: N, rate: R }` in a file, in source order. */
function bandsOf(src, label) {
  const found = [];
  const re = /limit:\s*([\d_]+|Infinity)\s*,\s*rate:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const limit = m[1] === 'Infinity' ? Infinity : Number(m[1].replace(/_/g, ''));
    found.push({ limit, rate: Number(m[2]) });
  }
  if (found.length === 0) {
    problems.push(`${label}: no { limit, rate } bands matched — this check no longer understands that file`);
  }
  return found;
}

function numberConstant(src, name, label) {
  const re = new RegExp(`${name}\\s*=\\s*([\\d_]+(?:\\.[\\d]+)?)`);
  const m = src.match(re);
  if (!m) {
    problems.push(`${label}: could not find ${name}`);
    return null;
  }
  return Number(m[1].replace(/_/g, ''));
}

const backendSrc = read(BACKEND, 'backend');
const frontendSrc = read(FRONTEND, 'frontend');

if (backendSrc && frontendSrc) {
  const backendBands = bandsOf(backendSrc, 'backend');
  const frontendBands = bandsOf(frontendSrc, 'frontend');

  if (backendBands.length !== frontendBands.length) {
    problems.push(
      `band count differs: backend has ${backendBands.length}, frontend has ${frontendBands.length}`,
    );
  } else {
    backendBands.forEach((b, i) => {
      const f = frontendBands[i];
      if (b.limit !== f.limit || b.rate !== f.rate) {
        const fmt = (x) =>
          `${x.limit === Infinity ? 'Infinity' : x.limit}c @ ${(x.rate * 100).toFixed(2)}%`;
        problems.push(`band ${i + 1} differs: backend ${fmt(b)} vs frontend ${fmt(f)}`);
      }
    });
  }

  const pairs = [
    ['MIN_COMMISSION_CENTS', 'MIN_PLATFORM_FEE_CENTS'],
    ['AUCTION_SPLIT_RATE', 'AUCTION_SPLIT_RATE'],
  ];
  for (const [backendName, frontendName] of pairs) {
    const b = numberConstant(backendSrc, backendName, 'backend');
    const f = numberConstant(frontendSrc, frontendName, 'frontend');
    if (b !== null && f !== null && b !== f) {
      problems.push(`${backendName} differs: backend ${b}, frontend ${f}`);
    }
  }
}

if (problems.length > 0) {
  console.error('\n[fee-sync] The platform fee schedule disagrees with the backend:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    '\nThe backend charges the money; the frontend only draws it. Fix ' +
      'backend/src/payments/fee.calculator.ts first, then mirror it in ' +
      'lib/platform-fee.ts.\n',
  );
  process.exit(1);
}

console.log('[fee-sync] platform fee schedule in sync with the backend.');
