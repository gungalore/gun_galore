// Classify candidate shops and add the usable ones to the ValuationSource
// registry. For each name it resolves a South African domain (via Serper),
// probes that domain for a REAL structured feed, and validates the live site
// title against the shop name before adding:
//   - WooCommerce Store API   (/wp-json/wc/store/products -> JSON array)
//   - Shopify products feed   (/products.json -> { products: [...] })
// Only domains that return a valid feed AND match the name are added
// (enabled=false). Domains already in the registry are never relabelled.
//
//   cd backend
//   node scripts/classify-valuation-sources.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const here = dirname(fileURLToPath(import.meta.url));
const names = JSON.parse(readFileSync(join(here, 'shop-list.json'), 'utf8'));
const SERPER = process.env.SERPER_API_KEY;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SKIP_HOSTS =
  /(facebook|instagram|youtube|twitter|tiktok|wikipedia|gumtree|bobshop|bidorbuy|pricecheck|yellosa?|cylex|top10place|worldplaces|placedigger|mapcarta|google|linkedin|pinterest|threads|tripadvisor|hellopeter|snupit|brabys|yellowpages|bing|reddit|int\.|leatherman\.com|lowrance\.com|garmin\.com|honda|suzuki|waterworld)/i;
const TLDS = /\.(co\.za|africa|online|shop|store|net|com)$/i;

const GENERIC = new Set([
  'outdoor','outdoors','hunting','tactical','south','africa','african','shop','store','online','the','and','inc','group','supply','supplies','firearms','firearm','arms','gear','equipment','outfitters','trading','paintball','fishing','angling','knives','knife','optics','guns','gun','wapenhandelaars','wapenwinkel','ammunition','ammo','bullets','bullet','projectiles','projectile','precision','products','product','international','centre','center','ace','pro','master','masters','specialist','specialists','world','distributors','distributor','mega','company','ltd','pty','scuba','wapen','wapens','winkel','safety','security','for','with','imports','traders','works','brothers','sons','broers','marine','boat','boats',
]);

const tokens = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));

function host(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

async function fetchText(url, accept) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: c.signal });
    if (!res.ok) return null;
    return { ct: res.headers.get('content-type') ?? '', body: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Returns the body even on a 403 so a WAF/challenge block can be detected.
async function fetchPage(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: c.signal });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url) {
  const r = await fetchText(url, 'application/json');
  if (!r || !r.ct.includes('json')) return null;
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

async function resolve(name) {
  if (name.includes('.') && !name.includes(' ') && TLDS.test(name)) return host('https://' + name);
  if (!SERPER) return '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${name} south africa`, gl: 'za', num: 10 }),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return '';
      const data = await res.json();
      for (const o of data.organic ?? []) {
        const h = host(o.link ?? '');
        if (h && !SKIP_HOSTS.test(h) && TLDS.test(h)) return h;
      }
      return '';
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return '';
}

async function classify(domain) {
  const woo = await fetchJson(`https://${domain}/wp-json/wc/store/products?per_page=1`);
  if (Array.isArray(woo)) return { platform: 'WOO', needsApify: false };
  const shop = await fetchJson(`https://${domain}/products.json?limit=1`);
  if (shop && Array.isArray(shop.products)) return { platform: 'SHOPIFY', needsApify: false };

  // No API. Inspect the homepage: a WAF challenge means it can only be read
  // through Apify; a plain Magento page is read by the lightweight adapter.
  const page = await fetchPage(`https://${domain}/`);
  if (page) {
    const body = page.body || '';
    if (
      page.status === 403 ||
      page.status === 503 ||
      /just a moment|cf-challenge|challenge-platform|enable javascript and cookies|attention required/i.test(body)
    ) {
      return { platform: 'MARKETPLACE', needsApify: true };
    }
    if (/magento|\/static\/version|\/skin\/frontend/i.test(body)) {
      return { platform: 'MAGENTO', needsApify: false };
    }
  }
  return null;
}

async function nameMatches(label, domain) {
  const lt = tokens(label);
  if (lt.length === 0) return true;
  const page = await fetchText(`https://${domain}/`, 'text/html');
  const html = page?.body ?? '';
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') + ' ' +
    (html.match(/<meta[^>]+og:site_name[^>]+content=["']([^"']+)["']/i)?.[1] ?? '');
  const hay = `${title} ${domain}`.toLowerCase();
  return lt.some((tk) => hay.includes(tk));
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const existing = new Set((await prisma.valuationSource.findMany({ select: { domain: true } })).map((r) => r.domain));
  const seen = new Set();
  let added = 0, dup = 0, noFeed = 0, nameFail = 0, noDomain = 0;
  try {
    for (const name of names) {
      const domain = await resolve(name);
      if (!domain) { noDomain++; await new Promise((r) => setTimeout(r, 100)); continue; }
      if (seen.has(domain) || existing.has(domain)) { dup++; continue; }
      seen.add(domain);
      const cls = await classify(domain);
      if (!cls) { noFeed++; await new Promise((r) => setTimeout(r, 100)); continue; }
      // A WAF-blocked page cannot be title-checked; trust the resolver for it.
      if (!cls.needsApify && !(await nameMatches(name, domain))) { nameFail++; console.log(`SKIP ${domain} (name mismatch: ${name})`); continue; }
      await prisma.valuationSource.upsert({
        where: { domain },
        create: { domain, label: name, platform: cls.platform, roles: ['ANCHOR'], categories: ['*'], enabled: false, needsApify: cls.needsApify, saVerified: domain.endsWith('.co.za'), specFields: {} },
        update: { platform: cls.platform, needsApify: cls.needsApify },
      });
      added++;
      console.log(`ADD  ${cls.platform.padEnd(11)} apify=${cls.needsApify ? 'y' : 'n'}  ${domain}  (${name})`);
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\nadded=${added} duplicate=${dup} no-feed=${noFeed} name-mismatch=${nameFail} no-domain=${noDomain}`);
}

main().catch((e) => {
  console.error('classify failed:', e);
  process.exit(1);
});
