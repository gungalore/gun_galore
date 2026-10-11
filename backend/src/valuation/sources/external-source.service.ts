import { Injectable, Logger } from '@nestjs/common';
import { RawComp } from '../schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { GunAfricaAdapter } from './adapters/gunafrica.adapter';
import { ApifyMarketplaceAdapter } from './adapters/apify-marketplace.adapter';
import { SitemapJsonLdAdapter } from './adapters/sitemap-jsonld.adapter';
import { ShopifyAdapter } from './adapters/shopify.adapter';
import { WooAdapter } from './adapters/woo.adapter';
import { withTimeout } from './http';
import { toRawComp } from './to-raw-comp';
import { ItemSpec, SourceAdapter, SourceQuery, SourceRole } from './types';

const DEFAULT_LIMIT = 25;
const DEFAULT_PER_SOURCE = 20;
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Runs the curated external sources for a valuation and returns normalized
 * comps. Add-only: these feed the pricing engine exactly like own-sold comps
 * and are never injected into any prompt. Inert unless
 * VALUATION_EXTERNAL_ENABLED=true and registry rows are enabled, so it costs
 * nothing until switched on.
 */
@Injectable()
export class ExternalSourceService {
  private readonly logger = new Logger(ExternalSourceService.name);
  private readonly adapters: SourceAdapter[];

  constructor(
    private readonly prisma: PrismaService,
    shopify: ShopifyAdapter,
    woo: WooAdapter,
    gunAfrica: GunAfricaAdapter,
    apifyMarketplace: ApifyMarketplaceAdapter,
    sitemapJsonLd: SitemapJsonLdAdapter,
  ) {
    this.adapters = [shopify, woo, gunAfrica, apifyMarketplace, sitemapJsonLd];
  }

  private adapterFor(platform: string, domain: string): SourceAdapter | undefined {
    return this.adapters.find(
      (a) => a.platform === platform && (!a.domains || a.domains.includes(domain)),
    );
  }

  /**
   * off    - the lane does nothing (default).
   * shadow - collect and log what external sources WOULD contribute, but do
   *          not change the member's result.
   * live   - external comps join the pricing pool.
   * VALUATION_EXTERNAL_ENABLED=true is kept as a synonym for 'live'.
   */
  mode(): 'off' | 'shadow' | 'live' {
    const m = (process.env.VALUATION_EXTERNAL_MODE ?? '').toLowerCase();
    if (m === 'shadow' || m === 'live') return m;
    return process.env.VALUATION_EXTERNAL_ENABLED === 'true' ? 'live' : 'off';
  }

  enabled(): boolean {
    return this.mode() !== 'off';
  }

  async collect(categorySlug: string, item: ItemSpec, conditionBand: string): Promise<RawComp[]> {
    if (this.mode() === 'off') return [];

    let rows: Array<{
      domain: string;
      platform: string;
      roles: string[];
      categories: string[];
    }>;
    try {
      rows = await this.prisma.valuationSource.findMany({
        where: { enabled: true },
        select: { domain: true, platform: true, roles: true, categories: true },
      });
    } catch (e) {
      this.logger.warn(`source registry read failed: ${(e as Error).message}`);
      return [];
    }

    const applicable = rows.filter(
      (r) => r.categories.includes('*') || r.categories.includes(categorySlug),
    );
    if (applicable.length === 0) return [];

    const limit = Number(process.env.VALUATION_EXTERNAL_LIMIT ?? DEFAULT_LIMIT);
    const perSource = Number(process.env.VALUATION_EXTERNAL_PER_SOURCE ?? DEFAULT_PER_SOURCE);
    const timeoutMs = Number(process.env.VALUATION_EXTERNAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const query: SourceQuery = {
      categorySlug,
      make: item.make,
      model: item.model,
      keySpec: item.keySpec,
      conditionBand,
      limit: perSource,
    };

    const jobs = applicable.flatMap((row) => {
      const adapter = this.adapterFor(row.platform, row.domain);
      if (!adapter) return [];
      return [this.runOne(adapter, row.domain, row.roles as SourceRole[], query, item, timeoutMs)];
    });

    const settled: Array<PromiseSettledResult<{ domain: string; rawHits: number; comps: RawComp[] }>> = [];
    const concurrency = Math.max(1, Number(process.env.VALUATION_EXTERNAL_CONCURRENCY ?? 8));
    for (let i = 0; i < jobs.length; i += concurrency) {
      settled.push(...(await Promise.allSettled(jobs.slice(i, i + concurrency))));
    }
    const out: RawComp[] = [];
    const stats: Array<{ domain: string; hits: number; priced: number }> = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        out.push(...s.value.comps);
        stats.push({ domain: s.value.domain, hits: s.value.rawHits, priced: s.value.comps.length });
      } else {
        this.logger.warn(`external source errored: ${String(s.reason).slice(0, 160)}`);
      }
    }
    // Learning loop: remember which sources actually produce priced hits so the
    // registry can rank them (best-effort, never blocks the valuation).
    void this.recordStats(stats);

    const seen = new Set<string>();
    return out
      .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
      .slice(0, Math.max(limit, 1));
  }

  private async runOne(
    adapter: SourceAdapter,
    domain: string,
    roles: SourceRole[],
    query: SourceQuery,
    item: ItemSpec,
    timeoutMs: number,
  ): Promise<{ domain: string; rawHits: number; comps: RawComp[] }> {
    try {
      const hits = await withTimeout(adapter.search(domain, query), timeoutMs);
      const comps = hits.map((h) => toRawComp(h, roles, item)).filter((c) => c.priceZar > 0);
      return { domain, rawHits: hits.length, comps };
    } catch (e) {
      this.logger.warn(`external source ${domain} failed: ${(e as Error).message}`);
      return { domain, rawHits: 0, comps: [] };
    }
  }

  /** Increment the registry's hit counters. Best-effort: failures are logged only. */
  private async recordStats(
    stats: Array<{ domain: string; hits: number; priced: number }>,
  ): Promise<void> {
    if (stats.length === 0) return;
    try {
      await Promise.all(
        stats.map((s) =>
          this.prisma.valuationSource.updateMany({
            where: { domain: s.domain },
            data: {
              totalHits: { increment: s.hits },
              pricedHits: { increment: s.priced },
              lastCheckAt: new Date(),
            },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`source stats update failed: ${(e as Error).message}`);
    }
  }
}
