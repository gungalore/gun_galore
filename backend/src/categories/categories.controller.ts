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
