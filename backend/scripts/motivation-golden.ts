import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MotivationStatus, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tryDecryptText } from '../src/common/blob-crypto';
import {
  scoreMotivation,
  summarise,
  type MotivationQuality,
} from '../src/motivations/motivation-quality';

// ─────────────────────────────────────────────────────────────────────────────
// A GOLDEN SET FOR THE MOTIVATION WRITER.
//
// motivation-eval.ts measures whatever is in the database. This file pins a
// stable set of reference numbers so a prompt, model or layout change is
// compared against the same documents on every run.
//
// It reads stored text only: no generation, no research, no model calls.
//
//   npm run motivation:golden:init -- --limit 20
//   npm run motivation:golden
//   npm run motivation:golden -- --json
//
// ⚠️ THRESHOLDS ARE FLOORS, NOT TARGETS. init derives them from the current
// pack with a margin. Tighten them deliberately after a reviewed improvement;
// never lower one to make a run go green.
// ─────────────────────────────────────────────────────────────────────────────

const CORPUS_PATH = resolve(
  __dirname,
  '..',
  'test',
  'fixtures',
  'motivation-golden.json',
);

interface GoldenCase {
  referenceNumber: string;
  licenceType: string;
  minSpecificity: number;
  maxGenericRun: number;
  minWords: number;
  maxWords: number;
  maxBanned: number;
  maxDuplicateSentences: number;
  note?: string;
}

interface GoldenCorpus {
  version: 1;
  createdAt: string;
  source: string;
  cases: GoldenCase[];
  aggregates?: Record<
    string,
    { minSpecificity?: number; maxGenericRun?: number; maxBanned?: number }
  >;
}

interface Actual {
  referenceNumber: string;
  licenceType: string;
  quality: MotivationQuality;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const round = (n: number, dp = 3): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const mean = (values: number[]): number =>
  values.length ? values.reduce((n, v) => n + v, 0) / values.length : 0;

function loadCorpus(): GoldenCorpus {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(
      `Golden corpus not found at ${CORPUS_PATH}. Run npm run motivation:golden:init first.`,
    );
  }
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as GoldenCorpus;
}

function saveCorpus(corpus: GoldenCorpus): void {
  const dir = dirname(CORPUS_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(CORPUS_PATH, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`Golden corpus written to ${CORPUS_PATH}`);
}

function thresholdsFor(quality: MotivationQuality): Omit<GoldenCase, 'referenceNumber' | 'licenceType'> {
  const words = Math.max(quality.words, 1);
  return {
    minSpecificity: Math.max(0, round(quality.specificity - 0.05)),
    maxGenericRun: quality.longestGenericRun + 1,
    minWords: Math.max(1, Math.floor(words * 0.7)),
    maxWords: Math.ceil(words * 1.5),
    maxBanned: 0,
    maxDuplicateSentences: quality.duplicateSentences,
  };
}

async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL),
  });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function init(limit: number, includeDrafts: boolean): Promise<void> {
  const corpus = await withPrisma(async (prisma) => {
    const rows = await prisma.motivation.findMany({
      where: {
        documentTextEncrypted: { not: null },
        ...(includeDrafts ? {} : { status: MotivationStatus.COMPLETED }),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        referenceNumber: true,
        licenceType: true,
        status: true,
        documentTextEncrypted: true,
      },
    });

    if (!rows.length) {
      throw new Error(
        includeDrafts
          ? 'No motivations with stored text at all. Generate and complete packs first.'
          : 'No COMPLETED motivations with stored text. Generate and complete packs, or pass --include-drafts to pin drafts for a smoke run.',
      );
    }

    if (includeDrafts) {
      const notCompleted = rows.filter(
        (row) => row.status !== MotivationStatus.COMPLETED,
      ).length;
      if (notCompleted > 0) {
        console.warn(
          `⚠️ ${notCompleted}/${rows.length} case(s) are not COMPLETED. These are smoke goldens, not approved packs.`,
        );
      }
    }

    const cases: GoldenCase[] = rows.map((row) => {
      const quality = scoreMotivation(
        tryDecryptText(row.documentTextEncrypted) ?? '',
      );
      console.log(
        `${row.referenceNumber}  ${row.licenceType}  ${summarise(quality)}`,
      );
      return {
        referenceNumber: row.referenceNumber,
        licenceType: String(row.licenceType),
        ...thresholdsFor(quality),
        note: `pinned ${new Date().toISOString().slice(0, 10)} status=${row.status}`,
      };
    });

    return {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      source:
        'init: latest COMPLETED motivations with stored text; thresholds from the pinned run minus margin',
      cases,
      aggregates: {},
    };
  });

  saveCorpus(corpus);
  console.log(
    `\nPinned ${corpus.cases.length} pack(s). Review the floors before relying on them.`,
  );
}

interface Failure {
  referenceNumber: string;
  rule: string;
  expected: string;
  actual: string;
}

function evaluate(corpus: GoldenCorpus, actual: Actual[]): Failure[] {
  const byRef = new Map(actual.map((row) => [row.referenceNumber, row]));
  const failures: Failure[] = [];

  for (const expected of corpus.cases) {
    const row = byRef.get(expected.referenceNumber);
    if (!row) {
      failures.push({
        referenceNumber: expected.referenceNumber,
        rule: 'present',
        expected: 'stored pack',
        actual: 'missing from database',
      });
      continue;
    }

    const q = row.quality;
    const checks: Array<[string, number, number, boolean]> = [
      ['specificity', expected.minSpecificity, q.specificity, q.specificity >= expected.minSpecificity],
      ['genericRun', expected.maxGenericRun, q.longestGenericRun, q.longestGenericRun <= expected.maxGenericRun],
      ['words.min', expected.minWords, q.words, q.words >= expected.minWords],
      ['words.max', expected.maxWords, q.words, q.words <= expected.maxWords],
      ['banned', expected.maxBanned, q.banned.length, q.banned.length <= expected.maxBanned],
      [
        'duplicateSentences',
        expected.maxDuplicateSentences,
        q.duplicateSentences,
        q.duplicateSentences <= expected.maxDuplicateSentences,
      ],
    ];

    for (const [rule, floor, value, ok] of checks) {
      if (!ok) {
        failures.push({
          referenceNumber: expected.referenceNumber,
          rule,
          expected: String(floor),
          actual: String(value),
        });
      }
    }
  }

  return failures;
}

async function check(json: boolean): Promise<void> {
  const corpus = loadCorpus();
  if (corpus.cases.length === 0) {
    throw new Error(
      'Golden corpus is empty. Run npm run motivation:golden:init after generating a pack.',
    );
  }
  const refs = corpus.cases.map((c) => c.referenceNumber);

  const actual = await withPrisma(async (prisma) => {
    const rows = await prisma.motivation.findMany({
      where: { referenceNumber: { in: refs } },
      select: {
        referenceNumber: true,
        licenceType: true,
        documentTextEncrypted: true,
      },
    });
    return rows.map<Actual>((row) => ({
      referenceNumber: row.referenceNumber,
      licenceType: String(row.licenceType),
      quality: scoreMotivation(tryDecryptText(row.documentTextEncrypted) ?? ''),
    }));
  });

  const failures = evaluate(corpus, actual);

  const byType = new Map<string, Actual[]>();
  for (const row of actual) {
    const list = byType.get(row.licenceType) ?? [];
    list.push(row);
    byType.set(row.licenceType, list);
  }

  const summary = {
    corpus: CORPUS_PATH,
    checked: corpus.cases.length,
    present: actual.length,
    failures: failures.length,
    byType: Object.fromEntries(
      [...byType].map(([type, rows]) => [
        type,
        {
          count: rows.length,
          meanSpecificity: round(mean(rows.map((r) => r.quality.specificity))),
          meanGenericRun: round(
            mean(rows.map((r) => r.quality.longestGenericRun)),
            2,
          ),
          banned: rows.reduce((n, r) => n + r.quality.banned.length, 0),
        },
      ]),
    ),
  };

  if (json) {
    console.log(JSON.stringify({ summary, failures }, null, 2));
  } else {
    console.log('GOLDEN SET');
    for (const [type, data] of Object.entries(summary.byType)) {
      console.log(
        `  ${type.padEnd(24)} n=${String(data.count).padEnd(3)} spec ${data.meanSpecificity}  generic ${data.meanGenericRun}  banned ${data.banned}`,
      );
    }
    if (failures.length === 0) {
      console.log(`\nPASS: ${actual.length}/${corpus.cases.length} packs within their floors.`);
    } else {
      console.log(`\nFAIL: ${failures.length} violation(s)`);
      for (const failure of failures) {
        console.log(
          `  ${failure.referenceNumber}  ${failure.rule}  expected ${failure.expected}  actual ${failure.actual}`,
        );
      }
    }
  }

  if (failures.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? 20);
  if (flag('init')) {
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw new Error('--limit must be between 1 and 200');
    }
    await init(limit, flag('include-drafts'));
    return;
  }
  await check(flag('json'));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
