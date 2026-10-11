// Scope every Woo/Shopify source to the categories it ACTUALLY stocks, by
// sampling its product feed, mapping each product's own category/type to our
// slugs, and keeping only the slugs that appear for a meaningful share of
// products. Sources that map to nothing keep ["*"]. Marketplace/sitemap sources
// keep their curated lists. A small prune list removes clearly-wrong resolves.
//
//   cd backend
//   node scripts/scope-valuation-sources.mjs

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAP = [
  ['firearms', ['rifle', 'shotgun', 'handgun', 'pistol', 'revolver', 'bolt action', 'semi-auto', 'firearm', 'guns', 'lever action', 'break action']],
  ['air-rifles', ['air rifle', 'airrifle', 'airgun', 'air gun', 'pcp', 'pellet gun', 'bb gun', 'airsoft']],
  ['optics', ['scope', 'optic', 'binocular', 'rangefinder', 'range finder', 'red dot', 'thermal', 'night vision', 'monocular', 'spotting']],
  ['knives', ['knife', 'knives', 'blade', 'machete', 'multi-tool', 'multitool', 'leatherman', 'axe']],
  ['reloading-equipment', ['reloading', 'reload', 'reloading press', ' dies', 'die set', 'tumbler', 'case prep', 'powder measure', 'trimmer']],
  ['reloading-components', ['brass', 'bullets', 'projectile', 'primers', 'casing', 'projectiles']],
  ['shooting-accessories', ['holster', 'sling', 'bipod', 'magazine', 'earmuff', 'ear muff', 'hearing protec', 'range bag', 'gun safe', 'gun bag', 'gun case', 'suppressor', 'moderator']],
  ['cleaning-equipment', ['gun cleaning', 'bore', 'solvent', 'bore brush', 'jag', 'gun care', 'gun oil']],
  ['fishing', ['fishing', 'reel', 'fishing rod', 'tackle', 'lure', 'angling', 'spinner', 'sinker', 'fly fishing', 'hook line', 'carp']],
  ['camping-outdoor', ['tent', 'sleeping bag', 'camping', 'camp ', 'backpack', 'stove', 'lantern', 'cooler', 'camp chair', 'hiking', 'headlamp', 'hydration', 'mattress', 'gazebo']],
  ['overlanding', ['4x4', 'overland', 'roof rack', 'rooftop', 'awning', 'fridge', 'drawer', 'bull bar', 'snorkel', 'recovery', 'diff lock', 'canopy', 'suspension', 'off-road', 'offroad', 'winch', 'light bar', 'load bar']],
  ['hunting', ['hunting', 'trail camera', 'blind', 'decoy', 'game call', 'biltong', 'deer', 'jackal', 'springbok']],
  ['outdoor-clothing-footwear', ['boots', 'footwear', 'jacket', 'fleece', 'apparel', 'clothing', 'sock', 'beanie', 'glove', 'raincoat']],
  ['archery-bowhunting', ['archery', 'crossbow', 'quiver', 'broadhead', 'recurve', 'compound bow', 'bow hunting', 'bowhunting']],
  ['self-defence', ['pepper spray', 'taser', 'body armour', 'body armor', 'baton', 'self defence', 'self-defense', 'stun gun']],
  ['paintball', ['paintball', 'paintball marker', 'paintball hopper', 'paintball gun']],
];

const PRUNE = ['int.leatherman.com', 'takie1976.co.za'];

function slugsFor(terms) {
  const hay = terms.join(' ').toLowerCase();
  const out = new Set();
  for (const [slug, kws] of MAP) if (kws.some((k) => hay.includes(k))) out.add(slug);
  return [...out];
}

async function fetchJson(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 9000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: c.signal });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function productTerms(platform, domain) {
  if (platform === 'WOO') {
    const data = await fetchJson(`https://${domain}/wp-json/wc/store/products?per_page=100`);
    if (!Array.isArray(data)) return null;
    return data.map((p) => (p.categories ?? []).map((c) => c?.name ?? '').filter(Boolean));
  }
  const data = await fetchJson(`https://${domain}/products.json?limit=250`);
  if (!data?.products) return null;
  return data.products.map((p) => [p.product_type ?? '', ...String(p.tags ?? '').split(/[,\s]+/)].filter(Boolean));
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const pruned = await prisma.valuationSource.deleteMany({ where: { domain: { in: PRUNE } } });
  if (pruned.count) console.log(`pruned ${pruned.count}: ${PRUNE.join(', ')}`);

  const rows = await prisma.valuationSource.findMany({ orderBy: { domain: 'asc' } });
  let scoped = 0, left = 0;
  for (const r of rows) {
    if (r.platform !== 'WOO' && r.platform !== 'SHOPIFY') continue;
    const perProduct = await productTerms(r.platform, r.domain);
    if (!perProduct || perProduct.length === 0) { left++; console.log(`leave    ${r.domain} (no feed)`); continue; }

    const counts = new Map();
    for (const terms of perProduct) {
      for (const slug of slugsFor(terms)) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    const total = perProduct.length;
    const threshold = Math.max(2, Math.ceil(total * 0.05));
    const slugs = [...counts.entries()]
      .filter(([, n]) => n >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([s]) => s);

    if (slugs.length === 0) { left++; console.log(`leave    ${r.domain} (no dominant category, ${total} products)`); continue; }
    await prisma.valuationSource.update({ where: { id: r.id }, data: { categories: slugs } });
    scoped++;
    console.log(`SCOPE    ${r.domain} -> ${slugs.join(', ')}`);
  }
  console.log(`\nscoped ${scoped}, left ${left}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
