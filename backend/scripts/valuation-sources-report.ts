// External source coverage report for the Value My Item engine.
//
//   cd backend
//   npx ts-node --transpile-only -r dotenv/config scripts/valuation-sources-report.ts
//
// Runs the configured external adapters against the accuracy fixtures and
// reports, per source, how many fixtures returned a priced comp. This is the
// practical "which sources are worth enabling" gate: it needs no member token
// and no photos. Registry rows are force-enabled for the run and restored to
// their previous state afterwards.

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { ExternalSourceService } from '../src/valuation/sources/external-source.service';
import { ApifyClient } from '../src/valuation/sources/apify-client';
import { ApifyMarketplaceAdapter } from '../src/valuation/sources/adapters/apify-marketplace.adapter';
import { ShopifyAdapter } from '../src/valuation/sources/adapters/shopify.adapter';
import { WooAdapter } from '../src/valuation/sources/adapters/woo.adapter';
import { GunAfricaAdapter } from '../src/valuation/sources/adapters/gunafrica.adapter';

interface Fixture {
  id: number;
  description: string;
  categorySlug: string;
  make: string | null;
  model: string | null;
  keySpec: string | null;
}

async function main(): Promise<void> {
  process.env.VALUATION_EXTERNAL_ENABLED = 'true';
  const fixtures = JSON.parse(
    readFileSync(join(__dirname, '..', 'test', 'valuation-accuracy', 'fixtures.json'), 'utf8'),
  ) as { items: Fixture[] };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const before = await prisma.valuationSource.findMany({ select: { id: true, enabled: true } });

  await prisma.valuationSource.updateMany({ data: { enabled: true } });
  try {
    const svc = new ExternalSourceService(
      prisma as never,
      new ShopifyAdapter(),
      new WooAdapter(),
      new GunAfricaAdapter(),
      new ApifyMarketplaceAdapter(new ApifyClient()),
    );

    const perSource = new Map<string, { items: number; comps: number; samplePrices: number[] }>();
    let itemsWithData = 0;
    const usable = fixtures.items.filter((i) => i.categorySlug !== 'OUT_OF_SCOPE' && i.make && i.model);

    for (const item of usable) {
      const comps = await svc.collect(
        item.categorySlug,
        { make: item.make, model: item.model, keySpec: item.keySpec },
        'GOOD',
      );
      if (comps.length) itemsWithData += 1;
      for (const c of comps) {
        const row = perSource.get(c.sourceSite) ?? { items: 0, comps: 0, samplePrices: [] };
        row.comps += 1;
        if (row.samplePrices.length < 5) row.samplePrices.push(c.priceZar);
        perSource.set(c.sourceSite, row);
      }
      const perItemSources = new Set(comps.map((c) => c.sourceSite));
      for (const s of perItemSources) perSource.get(s)!.items += 1;
    }

    console.log(`fixtures usable (make+model, in-scope): ${usable.length}`);
    console.log(`fixtures with >=1 external comp: ${itemsWithData}`);
    console.log('\nsource | fixtures served | comps | sample prices (R)');
    if (perSource.size === 0) {
      console.log('  (no source returned a comp on this box)');
    }
    for (const [domain, row] of [...perSource.entries()].sort((a, b) => b[1].items - a[1].items)) {
      console.log(`  ${domain} | ${row.items} | ${row.comps} | ${row.samplePrices.join(', ')}`);
    }
  } finally {
    for (const r of before) {
      await prisma.valuationSource.update({ where: { id: r.id }, data: { enabled: r.enabled } });
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('report failed:', e);
  process.exit(1);
});
