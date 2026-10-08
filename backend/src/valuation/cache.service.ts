import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface CacheKeyParts {
  categorySlug: string;
  make: string | null;
  model: string | null;
  keySpec: string | null;
  conditionBand: string;
}

/**
 * Normalised-spec valuation cache. Key = sha256 of the normalised category,
 * make, model, key specification and condition band. Only read when all four
 * spec fields are present (typed or confirmed by the member).
 */
@Injectable()
export class CacheService {
  private readonly aliases: Array<[RegExp, string]> = [
    [/\.?\s*338\s*win(chester)?\s*(mag(num)?)?/i, '338-win-mag'],
    [/\.?\s*308\s*win(chester)?/i, '308-win'],
    [/\.?\s*270\s*win(chester)?/i, '270-win'],
    [/\.?\s*223\s*(rem(ington)?)?/i, '223-rem'],
    [/\.?\s*9\s*mm(\s*luger)?/i, '9mm'],
  ];

  constructor(private readonly prisma: PrismaService) {}

  key(parts: CacheKeyParts): string | null {
    if (!parts.make || !parts.model || !parts.keySpec) return null;
    const normalised = {
      c: norm(parts.categorySlug),
      mk: this.normSpec(parts.make),
      md: norm(parts.model),
      ks: this.normSpec(parts.keySpec),
      cb: norm(parts.conditionBand),
    };
    return createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
  }

  async read(cacheKey: string): Promise<{
    resultJson: unknown;
    confidence: string;
    compCount: number;
  } | null> {
    const row = await this.prisma.valuationCache.findUnique({ where: { cacheKey } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    await this.prisma.valuationCache.update({
      where: { cacheKey },
      data: { hits: { increment: 1 } },
    });
    return {
      resultJson: row.resultJson,
      confidence: row.confidence,
      compCount: row.compCount,
    };
  }

  async write(
    cacheKey: string,
    parts: CacheKeyParts,
    resultJson: unknown,
    midPriceCents: number | null,
    compCount: number,
    confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  ): Promise<void> {
    const ttlDays = Number(process.env.VALUATION_CACHE_TTL_DAYS ?? 14);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.prisma.valuationCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        categorySlug: parts.categorySlug,
        resultJson: resultJson as object,
        midPriceCents,
        compCount,
        confidence,
        expiresAt,
      },
      update: {
        resultJson: resultJson as object,
        midPriceCents,
        compCount,
        confidence,
        expiresAt,
      },
    });
  }

  private normSpec(value: string): string {
    let v = norm(value);
    for (const [re, canonical] of this.aliases) {
      if (re.test(value)) return canonical;
    }
    return v;
  }
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[.,;:'"()\[\]{}]/g, '')
    .replace(/\s+/g, ' ');
}
