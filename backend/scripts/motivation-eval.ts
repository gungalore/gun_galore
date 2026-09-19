import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tryDecryptText } from '../src/common/blob-crypto';
import {
  scoreMotivation,
  summarise,
  type MotivationQuality,
} from '../src/motivations/motivation-quality';

// ────────────────────────────────────────────────────────────────────
// A SCORECARD FOR THE WRITER.
//
// ⚠️ THE BASELINE IS THE POINT. Without one, "the writer got richer" is a
// memory of a document somebody read last week, and a prompt change that added
// words rather than specifics is indistinguishable from one that worked. This
// prints the countable signals and can diff them against a stored run, so a
// change is kept or reverted on a number.
//
// ⚠️ GROUPED BY LICENCE TYPE, BECAUSE THE SIGNALS ARE TYPE-SPECIFIC. Species,
// terrain and distances are HUNTING evidence; a dedicated-sport pack scores
// zero on all three however well it is written, and averaging it together with
// a hunter would hide a real regression behind a type that was never going to
// move. The first run of this script did exactly that.
//
// ⚠️ IT READS WHAT IS ALREADY STORED — IT DOES NOT GENERATE. Running this must
// cost nothing: no model calls, no research, no regeneration. Generate the
// packs you want measured first, then measure them. That also means the same
// documents can be re-scored after a metric change, which is what makes the
// metric itself debuggable.
//
//   npx ts-node --project tsconfig.json -r dotenv/config \
//     scripts/motivation-eval.ts --limit 25 --save eval-baseline.json
//   npx ts-node --project tsconfig.json -r dotenv/config \
//     scripts/motivation-eval.ts --limit 25 --baseline eval-baseline.json
// ────────────────────────────────────────────────────────────────────

interface Row {
  referenceNumber: string;
  licenceType: string;
  quality: MotivationQuality;
}

interface Aggregate {
  count: number;
  meanWords: number;
  meanSpecificity: number;
  meanGenericRun: number;
  meanSpecies: number;
  meanDistances: number;
  meanAnnexures: number;
  bannedTotal: number;
}

interface Snapshot {
  takenAt: string;
  overall: Aggregate;
  byType: Record<string, Aggregate>;
  rows: { referenceNumber: string; licenceType: string; summary: string }[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mean = (v: number[]): number =>
  v.length ? v.reduce((n, x) => n + x, 0) / v.length : 0;

const round = (n: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function aggregateOf(rows: Row[]): Aggregate {
  return {
    count: rows.length,
    meanWords: round(mean(rows.map((r) => r.quality.words)), 1),
    meanSpecificity: round(mean(rows.map((r) => r.quality.specificity)), 3),
    meanGenericRun: round(
      mean(rows.map((r) => r.quality.longestGenericRun)),
      2,
    ),
    meanSpecies: round(mean(rows.map((r) => r.quality.species.length)), 2),
    meanDistances: round(mean(rows.map((r) => r.quality.distances.length)), 2),
    meanAnnexures: round(mean(rows.map((r) => r.quality.annexures.length)), 2),
    bannedTotal: rows.reduce((n, r) => n + r.quality.banned.length, 0),
  };
}

function byTypeOf(rows: Row[]): Record<string, Aggregate> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.licenceType) ?? [];
    list.push(r);
    groups.set(r.licenceType, list);
  }
  return Object.fromEntries(
    [...groups].map(([type, list]) => [type, aggregateOf(list)]),
  );
}

/**
 * Print one aggregate beside another, with the direction of each move.
 *
 * ⚠️ "MORE" IS NOT AUTOMATICALLY "BETTER". More words with flat specificity is
 * the failure this whole file exists to catch, so the word count is printed
 * without a judgement and specificity carries the only arrows that matter.
 */
function diff(label: string, before: Aggregate, after: Aggregate): void {
  const mark = (d: number, higherIsBetter: boolean | null) => {
    if (d === 0) return '  =';
    if (higherIsBetter === null) return d > 0 ? ` +${d}` : ` ${d}`;
    return `${(higherIsBetter ? d > 0 : d < 0) ? ' ✅' : ' ⚠️'} ${d > 0 ? '+' : ''}${d}`;
  };
  console.log(`\n${label}`);
  console.log(
    `  specificity  ${before.meanSpecificity} -> ${after.meanSpecificity}${mark(round(after.meanSpecificity - before.meanSpecificity, 3), true)}`,
  );
  console.log(
    `  generic run  ${before.meanGenericRun} -> ${after.meanGenericRun}${mark(round(after.meanGenericRun - before.meanGenericRun, 2), false)}`,
  );
  console.log(
    `  species      ${before.meanSpecies} -> ${after.meanSpecies}${mark(round(after.meanSpecies - before.meanSpecies, 2), true)}`,
  );
  console.log(
    `  distances    ${before.meanDistances} -> ${after.meanDistances}${mark(round(after.meanDistances - before.meanDistances, 2), true)}`,
  );
  console.log(
    `  annexures    ${before.meanAnnexures} -> ${after.meanAnnexures}${mark(round(after.meanAnnexures - before.meanAnnexures, 2), true)}`,
  );
  console.log(
    `  words        ${before.meanWords} -> ${after.meanWords}${mark(round(after.meanWords - before.meanWords, 1), null)}`,
  );
  console.log(
    `  banned       ${before.bannedTotal} -> ${after.bannedTotal}${mark(after.bannedTotal - before.bannedTotal, false)}`,
  );
}

function printAggregate(label: string, a: Aggregate): void {
  console.log(
    `  ${label.padEnd(26)} n=${String(a.count).padEnd(3)} spec ${a.meanSpecificity}  generic ${a.meanGenericRun}  words ${a.meanWords}  species ${a.meanSpecies}  dist ${a.meanDistances}  annex ${a.meanAnnexures}  banned ${a.bannedTotal}`,
  );
}

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? 20);
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL!),
  });

  try {
    const rows = await prisma.motivation.findMany({
      where: { documentTextEncrypted: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: Number.isFinite(limit) && limit > 0 ? limit : 20,
      select: {
        referenceNumber: true,
        licenceType: true,
        documentTextEncrypted: true,
      },
    });

    if (!rows.length) {
      console.log('No written motivations found. Generate some first.');
      return;
    }

    const scored: Row[] = rows.map((r) => ({
      referenceNumber: r.referenceNumber,
      licenceType: r.licenceType,
      quality: scoreMotivation(tryDecryptText(r.documentTextEncrypted) ?? ''),
    }));

    for (const r of scored) {
      console.log(
        `${r.referenceNumber}  ${r.licenceType}  ${summarise(r.quality)}`,
      );
    }

    const overall = aggregateOf(scored);
    const byType = byTypeOf(scored);

    console.log('\nBY LICENCE TYPE');
    for (const [type, a] of Object.entries(byType)) printAggregate(type, a);
    console.log('\nOVERALL');
    printAggregate('all types', overall);

    const save = arg('save');
    if (save) {
      const snapshot: Snapshot = {
        takenAt: new Date().toISOString(),
        overall,
        byType,
        rows: scored.map((r) => ({
          referenceNumber: r.referenceNumber,
          licenceType: r.licenceType,
          summary: summarise(r.quality),
        })),
      };
      writeFileSync(save, JSON.stringify(snapshot, null, 2));
      console.log(`\nBaseline written to ${save}`);
    }

    const baselinePath = arg('baseline');
    if (baselinePath) {
      const before = JSON.parse(readFileSync(baselinePath, 'utf8')) as Snapshot;
      console.log(
        `\nBaseline: ${before.overall.count} document(s), taken ${before.takenAt}`,
      );
      // ⚠️ PER TYPE, AND ONLY WHERE BOTH RUNS HAVE IT. Comparing a hunting
      // aggregate against a sport one is comparing two different jobs.
      for (const type of Object.keys(byType)) {
        const was = before.byType?.[type];
        if (was) diff(type, was, byType[type]);
      }
      diff('ALL TYPES', before.overall, overall);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  process.exitCode = 1;
});
