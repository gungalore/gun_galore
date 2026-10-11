import { Injectable, Logger } from '@nestjs/common';
import { RawComp } from '../schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { GunAfricaAdapter } from './adapters/gunafrica.adapter';
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
  ) {
    this.adapters = [shopify, woo, gunAfrica];
  }

  private adapterFor(platform: string, domain: string): SourceAdapter | undefined {
    return this.adapters.find(
      (a) => a.platform === platform && (!a.domains || a.domains.includes(domain)),
    );
  }

  enabled(): boolean {
    return process.env.VALUATION_EXTERNAL_ENABLED === 'true';
  }

  async collect(categorySlug: string, item: ItemSpec, conditionBand: string): Promise<RawComp[]> {
    if (!this.enabled()) return [];

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

    const settled = await Promise.allSettled(jobs);
    const out: RawComp[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') out.push(...s.value);
      else this.logger.warn(`external source errored: ${String(s.reason).slice(0, 160)}`);
    }

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
  ): Promise<RawComp[]> {
    try {
      const hits = await withTimeout(adapter.search(domain, query), timeoutMs);
      return hits
        .map((h) => toRawComp(h, roles, item))
        .filter((c) => c.priceZar > 0);
    } catch (e) {
      this.logger.warn(`external source ${domain} failed: ${(e as Error).message}`);
      return [];
    }
  }
}
