import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CategoriesService } from './categories.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Every route here is OptionalAuthGuard, not because the data is private —
// the outdoor catalogue is public — but because the category tree is the
// single richest firearm signal on the site. Signed out, these endpoints
// return only publicVisible categories; signed in, the full tree.
//
// OptionalAuthGuard NEVER rejects, so anonymous browse is unaffected and a
// stale token degrades to anonymous rather than 401-ing a public page.
@Controller('categories')
@UseGuards(OptionalAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @SkipThrottle()
  findAll(@CurrentUser() userId?: string) {
    return this.categoriesService.findAll(userId);
  }

  // Rolled-up active-listing counts per ACTIVE category (parent count =
  // own + all children). SkipThrottle (SSR fans these out from one IP).
  // Powers homepage tiles + facet counts. Declared BEFORE :slug so it isn't
  // captured as a slug param.
  @Get('with-counts')
  @SkipThrottle()
  withCounts(@CurrentUser() userId?: string) {
    return this.categoriesService.withCounts(userId);
  }

  // P4 — the EFFECTIVE attribute list for a category (its own + inherited
  // ancestor attributes, deduped by key, leaf-first). Powers the sell form,
  // which fetches this per selected category. Two-segment path so it is
  // matched before (and never captured by) the single-segment :slug route.
  //
  // Deliberately NOT visibility-gated: it is keyed on an opaque category id
  // (not a guessable slug), returns only field definitions — no listings, no
  // names of sibling categories — and the sell form needs it the moment a
  // member picks a members-only category.
  @Get(':id/attributes')
  @SkipThrottle()
  attributes(@Param('id') id: string) {
    return this.categoriesService.getEffectiveAttributes(id);
  }

  // Public category landing page data: the category + parent (breadcrumb) +
  // active children (drill-down). SkipThrottle (SSR fans these out from one
  // IP, same as browse). A members-only slug 404s for anonymous callers —
  // identical to an unknown slug, so existence isn't confirmed.
  @Get(':slug')
  @SkipThrottle()
  async findBySlug(
    @Param('slug') slug: string,
    @CurrentUser() userId?: string,
  ) {
    const tree = await this.categoriesService.findBySlugTree(slug, userId);
    if (!tree) throw new NotFoundException(`Unknown category: ${slug}`);
    return tree;
  }
}
