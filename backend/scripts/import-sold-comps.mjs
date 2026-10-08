// Import known SOLD prices (dealer list) into the valuation data moat.
//
//   cd backend
//   node scripts/import-sold-comps.mjs <categorySlug> <path-to.csv> [source]
//
// CSV header (case-insensitive): make,model,keySpec,condition,soldPriceRands,soldDate
//   soldPriceRands : number, e.g. 28500 or 28500.00
//   soldDate       : ISO date, e.g. 2026-09-01
//
// Nothing is written if a row is invalid; valid rows are inserted as SoldComp
// with source "dealer" (or the third argument).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const [categorySlug, csvPath, source = 'dealer'] = process.argv.slice(2);
if (!categorySlug || !csvPath) {
  console.error('Usage: node scripts/import-sold-comps.mjs <categorySlug> <csvPath> [source]');
  process.exit(1);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name.toLowerCase());
  const rows = [];
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    const get = (name) => {
      const i = idx(name);
      return i >= 0 ? cols[i] : '';
    };
    const price = Number.parseFloat(get('soldpricerands'));
    const soldAt = new Date(get('solddate'));
    if (!Number.isFinite(price) || price <= 0 || Number.isNaN(soldAt.getTime())) continue;
    rows.push({
      make: get('make') || null,
      model: get('model') || null,
      keySpec: get('keyspec') || null,
      condition: get('condition') || null,
      soldPriceCents: Math.round(price * 100),
      soldAt,
    });
  }
  return rows;
}

(async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
  try {
    const rows = parseCsv(readFileSync(csvPath, 'utf8'));
    if (rows.length === 0) {
      console.log('No valid rows found.');
      return;
    }
    await prisma.soldComp.createMany({
      data: rows.map((r) => ({ categorySlug, ...r, source })),
    });
    console.log(`Imported ${rows.length} sold comp(s) for ${categorySlug} (source: ${source}).`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
