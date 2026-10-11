// Validate registry rows against their live site. A row is a "mismatch" when
// its label has a distinctive token that appears nowhere in the site's title or
// domain (i.e. the resolver almost certainly picked the wrong domain). Reports
// every row; with --prune it deletes the mismatches.
//
//   cd backend
//   node scripts/validate-valuation-sources.mjs            # report only
//   node scripts/validate-valuation-sources.mjs --prune    # delete mismatches

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const prune = process.argv.includes('--prune');

const GENERIC = new Set([
  'outdoor','outdoors','hunting','tactical','south','africa','african','shop','store','online','the','and','inc','group','supply','supplies','firearms','firearm','arms','gear','equipment','outfitters','trading','paintball','fishing','angling','knives','knife','optics','guns','gun','wapenhandelaars','wapenwinkel','ammunition','ammo','bullets','bullet','projectiles','projectile','precision','products','product','international','centre','center','ace','pro','master','masters','specialist','specialists','world','distributors','distributor','mega','company','ltd','pty','supplies','scuba','wapen','wapens','winkel','safety','security','and','for','with','imports','traders','works','brothers','sons','broers',
]);

function tokens(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
}

async function siteTitle(domain) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const res = await fetch(`https://${domain}/`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: c.signal,
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return '';
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    return `${title} ${og}`.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function verdict(label, domain, title) {
  const lt = tokens(label);
  if (lt.length === 0) return 'skip-generic';
  const hay = `${title} ${domain}`.toLowerCase();
  return lt.some((tk) => hay.includes(tk)) ? 'match' : 'mismatch';
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const rows = await prisma.valuationSource.findMany({ orderBy: { domain: 'asc' } });
  const mismatches = [];
  for (const r of rows) {
    const title = await siteTitle(r.domain);
    const v = verdict(r.label, r.domain, title);
    console.log(`${v.padEnd(13)} ${r.domain.padEnd(30)} ${r.label}`);
    if (v === 'mismatch') mismatches.push(r.domain);
  }
  console.log(`\nrows=${rows.length} mismatch=${mismatches.length}`);
  if (prune && mismatches.length) {
    const del = await prisma.valuationSource.deleteMany({ where: { domain: { in: mismatches } } });
    console.log(`pruned ${del.count}:`, mismatches.join(', '));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('validate failed:', e);
  process.exit(1);
});
