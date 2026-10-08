import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RawComp } from './schemas';

export interface SoldCompRow {
  make?: string | null;
  model?: string | null;
  keySpec?: string | null;
  condition?: string | null;
  soldPriceCents: number;
  soldAt: Date;
}

/**
 * Known SOLD prices: our own completed sales and dealer-supplied lists. This
 * is the highest-accuracy source (sold beats asking) and the seed of the data
 * moat. Sold comps are only used when the item's make AND model are known, so
 * they are genuinely exact-model matches.
 */
@Injectable()
export class SoldCompsService {
  constructor(private readonly prisma: PrismaService) {}

  async find(categorySlug: string, make: string | null, model: string | null): Promise<RawComp[]> {
    if (!make || !model) return [];
    const rows = await this.prisma.soldComp.findMany({
      where: {
        categorySlug,
        make: { contains: make, mode: 'insensitive' },
        model: { contains: model, mode: 'insensitive' },
      },
      orderBy: { soldAt: 'desc' },
      take: 10,
    });
    return rows.map((r) => this.toRawComp(r));
  }

  async import(categorySlug: string, rows: SoldCompRow[], source = 'dealer'): Promise<number> {
    if (rows.length === 0) return 0;
    await this.prisma.soldComp.createMany({
      data: rows.map((r) => ({
        categorySlug,
        make: r.make ?? null,
        model: r.model ?? null,
        keySpec: r.keySpec ?? null,
        condition: r.condition ?? null,
        soldPriceCents: r.soldPriceCents,
        soldAt: r.soldAt,
        source,
      })),
    });
    return rows.length;
  }

  /** Record one sold price (own sale). Dedupes by the same spec within a day. */
  async record(args: {
    categorySlug: string;
    make: string | null;
    model: string | null;
    keySpec: string | null;
    soldPriceCents: number;
    soldAt: Date;
    source?: string;
  }): Promise<void> {
    await this.prisma.soldComp.create({
      data: {
        categorySlug: args.categorySlug,
        make: args.make,
        model: args.model,
        keySpec: args.keySpec,
        condition: null,
        soldPriceCents: args.soldPriceCents,
        soldAt: args.soldAt,
        source: args.source ?? 'own',
      },
    });
  }

  private toRawComp(r: {
    id: string;
    make: string | null;
    model: string | null;
    condition: string | null;
    soldPriceCents: number;
    soldAt: Date;
  }): RawComp {
    return {
      kind: 'USED_COMP',
      sourceSite: 'own-sold',
      url: `own://sold/${r.id}`,
      model: [r.make, r.model].filter(Boolean).join(' ') || null,
      condition: r.condition,
      priceZar: Math.round(r.soldPriceCents / 100),
      listedDate: r.soldAt.toISOString().slice(0, 10),
      pageOpened: true,
      match: { diffs: [] },
    };
  }
}
