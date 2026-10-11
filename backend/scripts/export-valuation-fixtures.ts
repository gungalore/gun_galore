// Export accuracy fixtures from REAL sold prices so the Value My Item harness
// can be run against ground truth.
//
//   cd backend
//   npx ts-node --transpile-only -r dotenv/config scripts/export-valuation-fixtures.ts
//
// Source: SoldComp (own completed sales + dealer lists). Each row is a real
// sold price for a known category/make/model, which is exactly what
// fixtures.json's expectedSoldZar wants. Writes fixtures.real.json (never
// overwrites the curated fixtures.json) and prints a per-category summary.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const rows = await prisma.soldComp.findMany({
      where: { soldPriceCents: { gt: 0 } },
      orderBy: { soldAt: 'desc' },
    });

    const seen = new Set<string>();
    const items = [];
    let id = 1;
    for (const r of rows) {
      if (!r.categorySlug || (!r.make && !r.model)) continue;
      const key = `${r.categorySlug}|${(r.make ?? '').toLowerCase()}|${(r.model ?? '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: id++,
        description: [r.make, r.model].filter(Boolean).join(' '),
        categorySlug: r.categorySlug,
        make: r.make,
        model: r.model,
        keySpec: r.keySpec,
        expectedSoldZar: Math.round(r.soldPriceCents / 100),
        _source: r.source,
        _soldAt: r.soldAt.toISOString().slice(0, 10),
      });
    }

    const byCategory = new Map<string, number>();
    for (const i of items) byCategory.set(i.categorySlug, (byCategory.get(i.categorySlug) ?? 0) + 1);

    const out = join(__dirname, '..', 'test', 'valuation-accuracy', 'fixtures.real.json');
    writeFileSync(out, JSON.stringify({ _comment: 'Generated from SoldComp real sales. Merge into fixtures.json.', items }, null, 2), 'utf8');

    console.log(`wrote ${items.length} real-sale fixtures to ${out}`);
    for (const [cat, n] of [...byCategory.entries()].sort()) console.log(`  ${cat}: ${n}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('export failed:', e);
  process.exit(1);
});
