import { Injectable, Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_MATCH_WEIGHTS } from '../comp.service';
import { CategoryConfig, PhotoChecklistItem } from '../valuation.types';

const DEFAULT_CONFIDENCE_CAP = { DIFF_SPEC: 'MEDIUM' as const, BRAND_CLASS: 'LOW' as const };

function withDefaults(cfg: CategoryConfig): CategoryConfig {
  return {
    ...cfg,
    matchDimensions: cfg.matchDimensions ?? [],
    matchWeights: cfg.matchWeights ?? DEFAULT_MATCH_WEIGHTS,
    matchConfidenceCap: cfg.matchConfidenceCap ?? DEFAULT_CONFIDENCE_CAP,
  };
}

// Loads the generic default config plus any per-category overrides from this
// directory at boot, then deep-merges category over default. All 17
// categories work through the default; a category file only refines it.
//
// Resolution uses the TOP-LEVEL category slug (sub-categories inherit the
// parent). Slugs match backend/prisma/seed.ts, e.g. `overlanding`, not
// `overlanding-4x4`.
@Injectable()
export class CategoryConfigs {
  private readonly logger = new Logger(CategoryConfigs.name);
  private defaultConfig!: CategoryConfig;
  private readonly bySlug = new Map<string, CategoryConfig>();

  constructor() {
    this.load();
  }

  private load(): void {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const defaultFile = files.find((f) => f === 'default.json');
    if (!defaultFile) {
      throw new Error('valuation config: default.json is missing');
    }
    this.defaultConfig = withDefaults(this.read(join(dir, defaultFile)));
    for (const file of files) {
      if (file === 'default.json') continue;
      const raw = withDefaults(this.read(join(dir, file)));
      const slug = raw.categorySlug ?? file.replace(/\.json$/, '');
      this.bySlug.set(slug, this.merge(this.defaultConfig, raw));
    }
    this.logger.log(
      `valuation configs loaded: default + ${this.bySlug.size} category override(s)`,
    );
  }

  private read(path: string): CategoryConfig {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CategoryConfig;
    if (!parsed || typeof parsed.strategy !== 'string') {
      throw new Error(`valuation config ${path} is invalid`);
    }
    return parsed;
  }

  private merge(base: CategoryConfig, over: CategoryConfig): CategoryConfig {
    const merged: CategoryConfig = {
      ...base,
      ...over,
      // Arrays replace wholesale (a category's checklist is its own; it does
      // not inherit the generic four items). Objects merge.
      photoChecklist: over.photoChecklist?.length
        ? over.photoChecklist
        : base.photoChecklist,
      seedQuestions: over.seedQuestions ?? base.seedQuestions,
      bannedTopicPatterns: over.bannedTopicPatterns?.length
        ? over.bannedTopicPatterns
        : base.bannedTopicPatterns,
      bannedItemPatterns: over.bannedItemPatterns?.length
        ? over.bannedItemPatterns
        : base.bannedItemPatterns,
      valueDrivers: over.valueDrivers?.length
        ? over.valueDrivers
        : base.valueDrivers,
      searchSources: over.searchSources?.length
        ? over.searchSources
        : base.searchSources,
      listingConstraints: {
        ...base.listingConstraints,
        ...(over.listingConstraints ?? {}),
      },
      depreciation:
        over.depreciation !== undefined ? over.depreciation : base.depreciation,
      unitCommodity:
        over.unitCommodity !== undefined ? over.unitCommodity : base.unitCommodity,
      legalFlags: over.legalFlags ?? base.legalFlags,
      matchDimensions:
        over.matchDimensions?.length ? over.matchDimensions : base.matchDimensions,
      matchWeights: over.matchWeights ?? base.matchWeights,
      matchConfidenceCap: over.matchConfidenceCap ?? base.matchConfidenceCap,
    };
    return merged;
  }

  /** The generic checklist shown before the category is known. */
  genericChecklist(): PhotoChecklistItem[] {
    return this.defaultConfig.photoChecklist;
  }

  /** Merged config for a top-level category slug, or the default. */
  forCategory(slug: string | null | undefined): CategoryConfig {
    if (!slug) return this.defaultConfig;
    return this.bySlug.get(slug) ?? this.defaultConfig;
  }

  /** True when a refined category config exists (otherwise it runs generic). */
  hasOverride(slug: string): boolean {
    return this.bySlug.has(slug);
  }

  /** Merged banned-item patterns (default plus the category's). */
  bannedItemPatterns(slug?: string | null): string[] {
    const config = this.forCategory(slug);
    const set = new Set([
      ...this.defaultConfig.bannedItemPatterns,
      ...config.bannedItemPatterns,
    ]);
    return [...set];
  }
}
