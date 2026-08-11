import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CategoriesService } from './categories.service';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Every route here is OptionalClerkGuard, not because the data is private —
// the outdoor catalogue is public — but because the category tree is the
// single richest firearm signal on the site. Signed out, these endpoints
// return only publicVisible categories; signed in, the full tree.
//
// OptionalClerkGuard NEVER rejects, so anonymous browse is unaffected and a
// stale token degrades to anonymous rather than 401-ing a public page.
@Controller('categories')
@UseGuards(OptionalClerkGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @SkipThrottle()
  findAll(@CurrentUser() clerkId?: string) {
    return this.categoriesService.findAll(clerkId);
  }

  // Rolled-up active-listing counts per ACTIVE category (parent count =
  // own + all children). SkipThrottle (SSR fans these out from one IP).
  // Powers homepage tiles + facet counts. Declared BEFORE :slug so it isn't
  // captured as a slug param.
  @Get('with-counts')
  @SkipThrottle()
  withCounts(@CurrentUser() clerkId?: string) {
    return this.categoriesService.withCounts(clerkId);
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
    @CurrentUser() clerkId?: string,
  ) {
    const tree = await this.categoriesService.findBySlugTree(slug, clerkId);
    if (!tree) throw new NotFoundException(`Unknown category: ${slug}`);
    return tree;
  }
}
