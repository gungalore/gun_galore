// One-shot Apify reachability probe. Runs the Website Content Crawler against
// the sites that block our plain GET (Facebook Marketplace, Gumtree, and the
// Cloudflare/DataDome retailers) and reports whether Apify gets real content
// back. Read-only investigation: it never writes to the app or the DB.
//
//   cd backend
//   npx ts-node --transpile-only -r dotenv/config scripts/apify-probe.ts
//
// Requires APIFY_TOKEN in .env. The free plan has NO residential proxies, so the
// hard targets will only pass after upgrading to a plan that includes them.
// Set APIFY_PROXY_GROUPS=RESIDENTIAL (default) to use them when available.

import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { ApifyClient } from '../src/valuation/sources/apify-client';

const TARGETS: Array<{ label: string; url: string }> = [
  { label: 'facebook marketplace', url: 'https://www.facebook.com/marketplace/search/?query=rifle' },
  { label: 'gumtree SA', url: 'https://www.gumtree.co.za/s-shotguns' },
  { label: 'game.co.za', url: 'https://www.game.co.za/' },
  { label: 'makro.co.za', url: 'https://www.makro.co.za/' },
  { label: 'checkers.co.za', url: 'https://www.checkers.co.za/' },
  { label: 'gunsa.co.za', url: 'https://gunsa.co.za/' },
  { label: 'pricecheck.co.za', url: 'https://www.pricecheck.co.za/' },
];

async function main(): Promise<void> {
  // Force-configure the client for this manual probe regardless of the app flag.
  process.env.VALUATION_APIFY_ENABLED = 'true';
  const apify = new ApifyClient();
  if (!apify.isConfigured()) {
    console.error('APIFY_TOKEN is not set in backend/.env — nothing to run.');
    process.exit(1);
  }
  const actor = process.env.APIFY_ACTOR_CONTENT_CRAWLER ?? 'apify/website-content-crawler';
  const groups = (process.env.APIFY_PROXY_GROUPS ?? 'RESIDENTIAL').split(',').map((s) => s.trim());

  for (const t of TARGETS) {
    const items = await apify.runActor(
      actor,
      {
        startUrls: [{ url: t.url }],
        maxCrawlPages: 1,
        crawlerType: 'playwright:chrome',
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: groups },
      },
      120,
    );
    const text = items
      .map((it) => {
        if (!it || typeof it !== 'object') return '';
        const o = it as Record<string, unknown>;
        return String(o.text ?? o.markdown ?? o.html ?? '');
      })
      .join(' ');
    const hasPrice = /R\s?\d{1,3}(?:[ ,]\d{3})+/.test(text);
    console.log(`\n${t.label} (${t.url})`);
    console.log(`  items=${items.length} chars=${text.length} pricePattern=${hasPrice}`);
    console.log(`  sample: ${text.slice(0, 180).replace(/\s+/g, ' ')}`);
  }
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
