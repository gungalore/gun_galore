// Ozow Payouts API test-case harness (CLI).
//
// Runs the mandatory money-out test cases against Ozow staging and writes the
// raw request/response JSON as evidence for the form Ozow sends after testing.
// It reuses the EXACT production code path (OzowService + the isolated
// OzowPayoutTestAttempt table) — no fabricated seller transactions.
//
// ⚠️ REFUSED BY DEFAULT: the service runs only when OZOW_PAYOUT_TEST=true on a
// non-live box, and the mock host is only reachable when OZOW_PAYOUT_MOCK=true.
//
// Usage (from backend/):
//   npm run build
//   node scripts/ozow-payout-test.mjs --suite=standard
//   node scripts/ozow-payout-test.mjs --suite=mock
//   node scripts/ozow-payout-test.mjs --case=standard-below-min
//
// Destination bank (staging) — set in .env or the environment:
//   OZOW_TEST_BANK_NAME     (default "Absa")
//   OZOW_TEST_BRANCH_CODE   (optional; overrides the bank name and resolves
//                            against Ozow's live bank list)
//   OZOW_TEST_ACCOUNT_HOLDER(default "Ozow Test" — not transmitted to Ozow)
//   OZOW_TEST_ACCOUNT_NUMBER(default 4050338500 — Ozow's staging Absa test acct)
//
// ⚠️ Use Ozow's staging test account (Absa 4050338500, given by Ozow) as the
// destination. That account number's holder name is never sent, so the default
// is cosmetic. The CDV case deliberately overrides the account with 1234567890.
//
// Webhook note: standard test cases 3–6 require Ozow to reach
// PUBLIC_API_URL/api/payments/webhook/ozow-payout{,-verify}. On production
// those URLs are already registered (alloutdoor.co.za); locally they need a
// public HTTPS tunnel.

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { OzowService } from '../dist/src/payments/ozow.service.js';
import { OzowPayoutTestService } from '../dist/src/manual-payments/ozow-payout-test.service.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const suite = args.suite ?? 'all';
const onlyCase = args.case ?? null;
const pollMs = Number(args.delay ?? 12_000);

if (process.env.OZOW_PAYOUT_TEST !== 'true') {
  console.error(
    'Refusing to run: set OZOW_PAYOUT_TEST=true (and OZOW_ENV not "live").',
  );
  process.exit(2);
}

const bankName = process.env.OZOW_TEST_BANK_NAME ?? 'Absa';
const branchCode = process.env.OZOW_TEST_BRANCH_CODE ?? '';
const accountHolder = process.env.OZOW_TEST_ACCOUNT_HOLDER ?? 'Ozow Test';
const accountNumber = process.env.OZOW_TEST_ACCOUNT_NUMBER ?? '4050338500';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const ozow = new OzowService();
const tests = new OzowPayoutTestService(prisma, ozow);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(process.cwd(), '.ozow-test-evidence', runId);
await mkdir(outDir, { recursive: true });

const results = [];
let failures = 0;

async function record(name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const data = await fn();
    results.push({ name, ok: true, startedAt, data });
    console.log(`✅ ${name}`);
    await writeFile(
      join(outDir, `${name}.json`),
      JSON.stringify({ name, ok: true, startedAt, data }, null, 2),
    );
  } catch (err) {
    failures += 1;
    const data = { error: err?.message ?? String(err) };
    results.push({ name, ok: false, startedAt, data });
    console.log(`❌ ${name}: ${data.error}`);
    await writeFile(
      join(outDir, `${name}.json`),
      JSON.stringify({ name, ok: false, startedAt, data }, null, 2),
    );
  }
}

const defaults = {
  accountHolder,
  accountNumber,
  bankName,
  ...(branchCode ? { branchCode } : {}),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollAttempt(attemptId) {
  return tests.getAttempt(attemptId);
}

// ── Standard API test cases (staging /v1) ────────────────────────────────
async function standardSuite() {
  // Test 1 — below the R1 minimum (must be rejected by Ozow).
  await record('standard-1-below-minimum', () =>
    tests.submitPayout({ ...defaults, amountCents: 50, label: 'below-min' }),
  );

  // Test 2 — above the R20 maximum (must be rejected by Ozow).
  await record('standard-2-above-maximum', () =>
    tests.submitPayout({ ...defaults, amountCents: 3_000, label: 'above-max' }),
  );

  // Tests 3–5 — a valid R1 payout that Ozow verifies, then completes. The
  // verify + notification callbacks are what prove the webhook endpoints.
  await record('standard-3-valid-payout', () =>
    tests.submitPayout({ ...defaults, amountCents: 100, label: 'valid' }),
  );

  // Test 8 — CDV account-number validation error.
  await record('standard-8-cdv-account', () =>
    tests.submitPayout({
      ...defaults,
      accountNumber: '1234567890',
      amountCents: 100,
      label: 'cdv',
    }),
  );

  // Test 9 — getPayout status. Submit another valid payout, wait, then read
  // back the attempt row and the authoritative status.
  await record('standard-9-get-payout-status', async () => {
    const submitted = await tests.submitPayout({
      ...defaults,
      amountCents: 100,
      label: 'status',
    });
    if (!submitted.payoutId) return submitted;
    await sleep(pollMs);
    const status = await ozow.getPayoutStatus(submitted.payoutId);
    return { submitted, status, attempt: await pollAttempt(submitted.attemptId) };
  });
}

// ── Mock API test cases (staging /mock/v1) ───────────────────────────────
async function mockSuite() {
  process.env.OZOW_PAYOUT_MOCK = process.env.OZOW_PAYOUT_MOCK ?? 'true';
  const scenarios = [
    ['mock-1-decryption-failed', 'decryptionFailed'],
    ['mock-2-not-verified', 'notVerified'],
    ['mock-3-key-missing', 'keyMissing'],
  ];
  for (const [name, scenario] of scenarios) {
    await record(name, async () => {
      // Arm exactly one scenario, confirmed on the wire (before → set → after).
      const config = await tests.setMockScenario(scenario);
      const submitted = await tests.submitPayout({
        ...defaults,
        amountCents: 100,
        label: name,
        mock: true,
      });
      let mockPayout = null;
      if (submitted.payoutId) {
        mockPayout = await tests.getMockPayout(submitted.payoutId);
      }
      // Reset before the next scenario.
      const reset = await tests.setMockScenario(null);
      return { config, submitted, mockPayout, reset };
    });
  }
}

const cases = {
  'standard-below-min': () =>
    tests.submitPayout({ ...defaults, amountCents: 50, label: 'below-min' }),
  'standard-above-max': () =>
    tests.submitPayout({ ...defaults, amountCents: 3_000, label: 'above-max' }),
  'standard-valid': () =>
    tests.submitPayout({ ...defaults, amountCents: 100, label: 'valid' }),
  'standard-cdv': () =>
    tests.submitPayout({
      ...defaults,
      accountNumber: '1234567890',
      amountCents: 100,
      label: 'cdv',
    }),
};

try {
  if (onlyCase) {
    const fn = cases[onlyCase];
    if (!fn) {
      console.error(`Unknown case "${onlyCase}"`);
      process.exitCode = 2;
    } else {
      await record(onlyCase, fn);
    }
  } else {
    if (suite === 'all' || suite === 'standard') await standardSuite();
    if (suite === 'all' || suite === 'mock') await mockSuite();
  }
} finally {
  await prisma.$disconnect();
}

await writeFile(
  join(outDir, '_summary.json'),
  JSON.stringify({ runId, suite, onlyCase, failures, results }, null, 2),
);

console.log(`\nEvidence: ${outDir}`);
console.log(failures === 0 ? 'All cases completed.' : `${failures} case(s) errored.`);
