/**
 * Load the verified CartridgeSpec seed (prisma/seed-data/cartridge-specs.json)
 * into the database. Idempotent upsert by cartridgeKey + prunes any row no
 * longer in the seed, so re-running fully reconciles the table to the file.
 * Static reference data — safe to run on prod.
 *
 *   npx ts-node scripts/seed-cartridge-specs.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

interface SpecSeed {
  cartridgeKey: string;
  displayName: string;
  grtName: string;
  standard: string;
  origin: string | null;
  cartridgeType: string | null;
  year: number | null;
  caseLengthMm: number | null;
  maxCartridgeLengthMm: number | null;
  maxPressureBar: number | null;
  maxPressurePsi: number | null;
  caseCapacity: number | null;
  officialPdfUrl: string | null;
}

async function main() {
  const file = path.resolve(
    __dirname,
    '..',
    'prisma/seed-data/cartridge-specs.json',
  );
  const specs: SpecSeed[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = specs.map((s) => s.cartridgeKey);

  let up = 0;
  for (const s of specs) {
    const data = {
      displayName: s.displayName,
      grtName: s.grtName,
      standard: s.standard,
      origin: s.origin,
      cartridgeType: s.cartridgeType,
      year: s.year,
      caseLengthMm: s.caseLengthMm,
      maxCartridgeLengthMm: s.maxCartridgeLengthMm,
      maxPressureBar: s.maxPressureBar,
      maxPressurePsi: s.maxPressurePsi,
      caseCapacityGrH2O: s.caseCapacity,
      officialPdfUrl: s.officialPdfUrl,
    };
    await prisma.cartridgeSpec.upsert({
      where: { cartridgeKey: s.cartridgeKey },
      create: { cartridgeKey: s.cartridgeKey, ...data },
      update: data,
    });
    up++;
  }
  const pruned = await prisma.cartridgeSpec.deleteMany({
    where: { cartridgeKey: { notIn: keys } },
  });
  console.log(`Upserted ${up} cartridge specs; pruned ${pruned.count} stale.`);
  const byStd = await prisma.cartridgeSpec.groupBy({
    by: ['standard'],
    _count: true,
  });
  console.log(byStd.map((b) => `${b.standard}:${b._count}`).join('  '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
