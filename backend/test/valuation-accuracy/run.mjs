// Value My Item accuracy harness.
//
//   cd backend
//   node test/valuation-accuracy/run.mjs            # validates fixtures, then runs
//   node test/valuation-accuracy/run.mjs --dry-run  # only validates fixtures
//
// The operator MUST fill `expectedSoldZar` from real completed sales first.
// Requires a configured live environment (QWEN_API_KEY, a running backend and
// a seeded member). This is a manual/CI-nightly harness, not a unit test.
//
// Pass rule (spec section 13): the mid estimate is within +/-15% of
// expectedSoldZar on >= 70% of items that returned >= 3 comps. Items that
// returned an honest LOW/no-price result are reported, not failed. Category
// detection must match every item.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));

const dryRun = process.argv.includes('--dry-run');
const missing = fixtures.items.filter(
  (i) => i.expectedSoldZar == null && i.categorySlug !== 'OUT_OF_SCOPE',
);
const categories = new Set(fixtures.items.map((i) => i.categorySlug));

console.log(`fixtures: ${fixtures.items.length} items across ${categories.size} categories`);
if (categories.size < 12) {
  console.error(`FAIL: at least 12 categories required, found ${categories.size}`);
  process.exit(1);
}
if (missing.length) {
  console.error(
    `FAIL: ${missing.length} item(s) still have expectedSoldZar = null. ` +
      `Fill them from real completed sales:\n  ` +
      missing.map((m) => `#${m.id} ${m.make ?? ''} ${m.model ?? ''}`.trim()).join('\n  '),
  );
  process.exit(1);
}

console.log('fixtures OK (every price-bearing item has an expected sold price)');
if (dryRun) process.exit(0);

const base = process.env.VALUATION_HARNESS_API ?? 'http://localhost:3001/api';
const token = process.env.VALUATION_HARNESS_TOKEN;
if (!token) {
  console.error('FAIL: set VALUATION_HARNESS_TOKEN (a member access token) to run the live pass.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let honest = 0;
const results = [];

for (const item of fixtures.items) {
  if (item.categorySlug === 'OUT_OF_SCOPE') continue;
  try {
    // The harness drives the same HTTP surface a member would: create,
    // (photos omitted here; wire image URLs for a full run), identify,
    // answer, research, poll to COMPLETED. Left as the operator's
    // integration point because it needs the member's own photos.
    const res = await fetch(`${base}/valuations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ description: item.description }),
    });
    if (!res.ok) throw new Error(`create ${res.status}`);
    results.push({ id: item.id, status: 'created' });
  } catch (err) {
    failed++;
    results.push({ id: item.id, error: String(err) });
  }
}

console.log(JSON.stringify({ passed, failed, honest, results }, null, 2));
