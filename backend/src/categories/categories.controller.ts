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
