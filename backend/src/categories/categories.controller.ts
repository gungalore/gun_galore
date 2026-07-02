import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @SkipThrottle()
  findAll() {
    return this.categoriesService.findAll();
  }

  // Rolled-up active-listing counts per ACTIVE category (parent count =
  // own + all children). Public catalogue data → no auth, SkipThrottle
  // (SSR fans these out from one IP). Powers homepage tiles + facet
  // counts. Declared BEFORE :slug so it isn't captured as a slug param.
  @Get('with-counts')
  @SkipThrottle()
  withCounts() {
    return this.categoriesService.withCounts();
  }

  // P4 — the EFFECTIVE attribute list for a category (its own + inherited
  // ancestor attributes, deduped by key, leaf-first). Powers the sell form,
  // which fetches this per selected category. Two-segment path so it is
  // matched before (and never captured by) the single-segment :slug route.
  // Public read → SkipThrottle (the sell form + SSR fan these from one IP).
  @Get(':id/attributes')
  @SkipThrottle()
  attributes(@Param('id') id: string) {
    return this.categoriesService.getEffectiveAttributes(id);
  }

  // Public category landing page data: the category + parent (breadcrumb) +
  // active children (drill-down). Public read → SkipThrottle (SSR fans these
  // out from one IP, same as browse).
  @Get(':slug')
  @SkipThrottle()
  async findBySlug(@Param('slug') slug: string) {
    const tree = await this.categoriesService.findBySlugTree(slug);
    if (!tree) throw new NotFoundException(`Unknown category: ${slug}`);
    return tree;
  }
}
