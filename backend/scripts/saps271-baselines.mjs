#!/usr/bin/env node
// Check every drawn baseline against the form's OWN printed label on that row.
//
// A systematic vertical offset is the failure that passes every other test: the
// values are correct, on the right page, in the right order — and sitting a
// few points above their boxes, which only shows up on paper. Comparing our
// computed baseline to the baseline SAPS itself used for that row's label
// catches it without rendering anything.
//
//   node scripts/saps271-baselines.mjs assets/saps271-blank.pdf [maxPt]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { getDocument } = await import(
  pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
);

const SRC = process.argv[2] ?? 'assets/saps271-blank.pdf';
const MAX = Number(process.argv[3] ?? 2);
const SIZE = 9; // DEFAULT_FONT in saps271.service.ts

const coordsSrc = fs.readFileSync('src/motivations/saps271-coords.ts', 'utf8');
const COORDS = JSON.parse(
  coordsSrc.match(/export const SAPS271_COORDS = ([\s\S]*?) as const satisfies/)[1],
);

const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(SRC)) }).promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent();
  pages[p] = tc.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
}

// "62.1" and "(1)" are item MARKERS, printed above the row rather than on it.
const isMarker = (s) => /^(\(\d+\)|[\d.]+)$/.test(s);

let checked = 0;
let worst = { pt: 0, what: 'nothing' };
const bad = [];
for (const [name, f] of Object.entries(COORDS)) {
  if (f.kind !== 'text') continue;
  const ours = f.y + f.h / 2 - SIZE / 2 + 1;
  const row = (pages[f.page] ?? []).filter(
    (i) => i.y >= f.y - 1 && i.y <= f.y + f.h + 1 && i.x < f.x && !isMarker(i.s),
  );
  if (!row.length) continue;
  const label = row.reduce((a, b) => (b.x > a.x ? b : a));
  const d = Math.abs(ours - label.y);
  checked++;
  if (d > worst.pt) worst = { pt: d, what: `${name} vs "${label.s}"` };
  if (d > MAX) bad.push(`${name}: ${d.toFixed(2)}pt off "${label.s}"`);
}

console.log(`checked ${checked} text boxes against the form's own row labels`);
console.log(`largest deviation: ${worst.pt.toFixed(2)}pt (${worst.what})`);
if (bad.length) {
  console.log(`\nOVER ${MAX}pt:`);
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log(`all within ${MAX}pt of where SAPS put its own text`);
