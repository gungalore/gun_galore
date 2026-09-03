#!/usr/bin/env node
/**
 * THE DESK — the cutover readiness check.
 *
 * Phase 6 deletes the legacy admin frontend wholesale. This script answers the
 * only question that matters before that: what would stop working?
 *
 * It reads lib/desk-cutover.ts and reports every legacy route with no Desk
 * replacement. It exits non-zero while any remain, so the cutover commit
 * cannot be made green by accident.
 *
 *   node scripts/desk-cutover.cjs          report readiness
 *   node scripts/desk-cutover.cjs --strict fail the build unless ready
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'lib', 'desk-cutover.ts');
const src = fs.readFileSync(SRC, 'utf8');

// Parse the map out of the TS source rather than importing it: this is a
// plain CJS script with no TS toolchain, and the shape is stable enough that
// a regex is honest here. If it ever stops matching, the counts go to zero
// and the check fails loudly rather than passing silently.
const entries = [...src.matchAll(/legacy:\s*'([^']+)',\s*desk:\s*(null|'[^']*'),\s*coverage:\s*'(\w+)',\s*note:\s*'([^']*)'/g)]
  .map((m) => ({ legacy: m[1], desk: m[2] === 'null' ? null : m[2].slice(1, -1), coverage: m[3], note: m[4] }));

if (entries.length === 0) {
  console.error('  Cutover check: could not parse lib/desk-cutover.ts — refusing to report ready.');
  process.exit(1);
}

const armed = /export const CUTOVER_ARMED = true/.test(src);
const report = process.argv.includes('--report');
const none = entries.filter((e) => e.coverage === 'none');
const partial = entries.filter((e) => e.coverage === 'partial');
const replaced = entries.filter((e) => e.coverage === 'replaced');
const retired = entries.filter((e) => e.coverage === 'retired');

if (report) console.log(`\n  Cutover readiness — ${entries.length} legacy routes\n`);
if (report) console.log(`    replaced : ${replaced.length}`);
if (report) console.log(`    retired  : ${retired.length}   (deliberately dropped; safe to delete)`);
if (report) console.log(`    partial  : ${partial.length}   (redirecting loses something)`);
if (report) console.log(`    none     : ${none.length}   (redirecting deletes the capability)\n`);

if (report && none.length) {
  console.log('  No Desk replacement at all:\n');
  for (const e of none) console.log(`    ${e.legacy}\n      ${e.note}\n`);
}
if (report && partial.length) {
  console.log('  Partial — something is lost:\n');
  for (const e of partial) console.log(`    ${e.legacy} -> ${e.desk}\n      ${e.note}\n`);
}

const ready = none.length === 0 && partial.length === 0; // retired counts as ready
if (report) console.log(
  ready
    ? '  READY. Every legacy route has a full Desk replacement.\n'
    : `  NOT READY. ${none.length + partial.length} routes would lose capability.\n`,
);

if (armed && !ready) {
  console.error('  CUTOVER_ARMED is true while routes are still uncovered. Refusing.\n');
  process.exit(1);
}
if (process.argv.includes('--strict') && !ready) process.exit(1);
