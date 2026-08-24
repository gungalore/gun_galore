#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────
// PRINT THE CHECKSUM OF THE SAPS 271 TEMPLATE.
//
//   npm run saps271:checksum            # the shipped assets/saps271-blank.pdf
//   npm run saps271:checksum -- path.pdf
//
// Run this when the form is replaced. It prints the hash to paste into
// TEMPLATE_SHA256 in saps271.service.ts.
//
// ⚠️ THE HASH IS THE LAST STEP, NOT THE FIRST. Every value on the 271 is
// placed by absolute coordinate, because the distributed form's 1,072 AcroForm
// field names are randomised and meaningless. Those coordinates were measured
// against one specific PDF. A new revision — a reflowed page, one extra line
// of preamble, a box nudged 4 mm — still resolves every coordinate, still
// draws, and lands wrong. Nothing throws.
//
// So the order is: replace the PDF, RE-MEASURE the coordinate map against it,
// verify a filled sample against the real form, and only then update the hash.
// Updating the hash alone silences the guard and reinstates precisely the
// failure it exists to prevent — a form that looks filled in, gets signed, and
// carries somebody's answers in the wrong boxes to a police station.
// ────────────────────────────────────────────────────────────────────
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target =
  process.argv[2] ?? path.join(__dirname, '..', 'assets', 'saps271-blank.pdf');

let bytes;
try {
  bytes = fs.readFileSync(target);
} catch (err) {
  console.error(`Could not read ${target}: ${err.message}`);
  process.exit(1);
}

const sha = createHash('sha256').update(bytes).digest('hex');

console.log('');
console.log(`  file    ${target}`);
console.log(`  size    ${(bytes.length / 1024).toFixed(0)} KB`);
console.log(`  sha256  ${sha}`);
console.log('');
console.log('  Paste into TEMPLATE_SHA256 in src/motivations/saps271.service.ts');
console.log('  — but only after re-measuring the coordinate map against this');
console.log('  file and checking a filled sample against the real form.');
console.log('');
