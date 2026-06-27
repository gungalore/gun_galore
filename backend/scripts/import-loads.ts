/**
 * Import a locally-built ManualLoad seed (JSONL) into the database. Validates
 * every row (safety: drop anything malformed or out-of-range), computes the
 * canonical cartridgeKey (same function the query uses), refreshes the manuals
 * present in the seed, and bulk-inserts. Run on prod after `git pull`:
 *
 *   cd /home/gungalore/app/backend
 *   npx ts-node --project tsconfig.json scripts/import-loads.ts prisma/seed-data/manual-loads.jsonl
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { cartridgeKey } from '../src/load-lab/recommended-loads.service';

interface SeedRow {
  cartridge?: string;
  powderMaker?: string | null;
  powderName?: string | null;
  bulletMaker?: string | null;
  bulletName?: string | null;
  bulletWeightGr?: number | null;
  startGr?: number | null;
  maxGr?: number | null;
  startVelFps?: number | null;
  maxVelFps?: number | null;
  coalMm?: number | null;
  primer?: string | null;
  manualLabel?: string | null;
  page?: number | null;
  fillPctStart?: number | null;
  fillPctMax?: number | null;
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length ? t : null;
};
// Case fill is a plausible 1–200% (compressed loads can exceed 100). Drop junk.
const clampFill = (v: number | null): number | null =>
  v != null && v >= 1 && v <= 200 ? v : null;

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: import-loads.ts <seed.jsonl>');
    process.exit(1);
  }
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  let badJson = 0;
  let dropped = 0;
  const labels = new Set<string>();
  const data: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    let r: SeedRow;
    try {
      r = JSON.parse(line);
    } catch {
      badJson += 1;
      continue;
    }
    const cartridge = s(r.cartridge);
    const powderName = s(r.powderName);
    const bw = n(r.bulletWeightGr);
    const start = n(r.startGr);
    const max = n(r.maxGr);
    const label = s(r.manualLabel);
    // Safety validity gate — a usable load needs a cartridge, powder, a sane
    // bullet weight, and start ≤ max in a plausible grain range.
    if (
      !cartridge ||
      !powderName ||
      !label ||
      !(bw && bw >= 10 && bw <= 1000) ||
      !(start && start > 0) ||
      !(max && max > 0) ||
      start > max ||
      max > 300
    ) {
      dropped += 1;
      continue;
    }
    labels.add(label);
    data.push({
      cartridge,
      cartridgeKey: cartridgeKey(cartridge),
      powderMaker: s(r.powderMaker) ?? '',
      powderName,
      bulletMaker: s(r.bulletMaker),
      bulletName: s(r.bulletName),
      bulletWeightGr: bw,
      startGr: start,
      maxGr: max,
      startVelFps: n(r.startVelFps),
      maxVelFps: n(r.maxVelFps),
      coalMm: n(r.coalMm),
      primer: s(r.primer),
      manualLabel: label,
      pageNumber: Math.max(0, Math.round(n(r.page) ?? 0)),
      // Published case-fill %, where the manual prints it (clamp out absurd OCR).
      fillPctStart: clampFill(n(r.fillPctStart)),
      fillPctMax: clampFill(n(r.fillPctMax)),
    });
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL!),
  });
  // The seed is the COMPLETE source of truth (all manuals) — clear the whole
  // table so renamed/removed sources (e.g. the old "Somchem Reloading Data"
  // PDF, now replaced by the somchemreload.com site rows) don't linger.
  const del = await prisma.manualLoad.deleteMany({});
  let inserted = 0;
  for (let i = 0; i < data.length; i += 1000) {
    const res = await prisma.manualLoad.createMany({
      data: data.slice(i, i + 1000) as never,
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  console.log(
    `seed lines ${lines.length} | bad-json ${badJson} | dropped(invalid) ${dropped} | valid ${data.length}\n` +
      `manuals ${labels.size} | cleared ${del.count} old | inserted ${inserted}`,
  );
  // Per-cartridge top counts for a sanity glance.
  const byCart = await prisma.manualLoad.groupBy({
    by: ['cartridge'],
    _count: { _all: true },
    orderBy: { _count: { cartridge: 'desc' } },
    take: 15,
  });
  console.log('\nTop cartridges by load count:');
  for (const c of byCart) console.log(`  ${c.cartridge}: ${c._count._all}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
