import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ListingsService } from './listings.service';
import { PriceEstimateService } from './price-estimate.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';
import { CrossSellDto } from './dto/cross-sell.dto';
import { PreviewListingDto } from './dto/preview-listing.dto';
import { ClerkGuard } from '../auth/clerk.guard';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly priceEstimate: PriceEstimateService,
  ) {}

  // --- Public ---
  // SkipThrottle on public reads: SSR fans these out from the Next.js
  // dev server (single localhost IP) and the default 60 req/min/IP
  // bucket trips immediately — apiFetch throws, page calls notFound(),
  // user sees a 404 on every listing. Writes downstream still throttle.

  @Get()
  @SkipThrottle()
  // OptionalClerkGuard so search-insight events can attribute the searcher
  // when signed in; anonymous browse is unaffected (guard never rejects).
  @UseGuards(OptionalClerkGuard)
  browse(@Query() dto: BrowseListingsDto, @CurrentUser() clerkId?: string) {
    return this.listingsService.browse(dto, clerkId);
  }

  // Cross-sell ("you might also need…"). MUST stay above @Get(':id') so
  // 'cross-sell' isn't captured as an id. Public read → SkipThrottle like
  // browse (SSR fans these out from one IP).
  @Get('cross-sell')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  crossSell(@Query() dto: CrossSellDto, @CurrentUser() clerkId?: string) {
    return this.listingsService.crossSell(dto, clerkId);
  }

  // Brand/make facet values for the storefront filter. MUST stay above
  // @Get(':id') so 'brands' isn't captured as an id. Public read →
  // SkipThrottle like browse (SSR fans these out from one IP).
  @Get('brands')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  brands(@CurrentUser() clerkId?: string) {
    return this.listingsService.listBrands(60, clerkId);
  }

  // ACTIVE listing ids + lastModified for the XML sitemap. MUST stay above
  // @Get(':id'). Public read → SkipThrottle.
  @Get('sitemap')
  @SkipThrottle()
  sitemap() {
    return this.listingsService.sitemapEntries();
  }

  // Public marketplace config the sell form needs to mirror server-side
  // gates without hardcoding constants (e.g. the DG lithium-Wh limit, which
  // is admin-tunable). MUST stay above @Get(':id'). Public read → SkipThrottle.
  @Get('config')
  @SkipThrottle()
  publicConfig() {
    return this.listingsService.getPublicConfig();
  }

  // Facet counts for the storefront FilterBar ("Toyota (12)"). Takes the same
  // browse query params and returns Meili's facetDistribution. MUST stay above
  // @Get(':id') so 'facets' isn't captured as an id. Public read (SSR fans
  // these out from one IP) → SkipThrottle like browse.
  @Get('facets')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  facets(@Query() dto: BrowseListingsDto, @CurrentUser() clerkId?: string) {
    return this.listingsService.facets(dto, clerkId);
  }

  // P5.6 — sold-price comps for a category ("similar items recently sold for
  // R900–R1,400"). POPIA-safe aggregate (price + coarse month only), gated to
  // a minimum sale count. MUST stay above @Get(':id'). Public read → SkipThrottle.
  @Get('sold-comps')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  soldComps(
    @Query() dto: { categorySlug?: string; categoryId?: string },
    @CurrentUser() clerkId?: string,
  ) {
    return this.listingsService.soldComps(dto, clerkId);
  }

  // P5.7 — folded, gated brand list for the /brands index + XML sitemap.
  // MUST stay above @Get(':id'). Public read → SkipThrottle.
  @Get('brand-index')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  brandIndex(@CurrentUser() clerkId?: string) {
    return this.listingsService.listBrandsWithCounts(undefined, clerkId);
  }

  // P5.7 — resolve a brand slug to its display label + count (or 404 when the
  // brand is too thin to have a page). The /brand/[slug] page uses this for the
  // header + 404 decision, then browses with ?brandSlug for the grid. Two path
  // segments so it can't shadow @Get(':id'), but kept here for clarity.
  @Get('brand/:slug')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  async brandBySlug(
    @Param('slug') slug: string,
    @CurrentUser() clerkId?: string,
  ) {
    const b = await this.listingsService.resolveBrandSlug(
      slug,
      undefined,
      clerkId,
    );
    if (!b) throw new NotFoundException('Brand not found');
    return { slug: b.slug, label: b.label, count: b.count };
  }

  // --- Protected ---
  // IMPORTANT: this route MUST appear before @Get(':id') below. Nest
  // matches routes in declaration order — if @Get(':id') comes first,
  // it captures '/listings/mine' as id="mine" → 404 → /my/listings on
  // the frontend silently shows "No listings yet" even though the
  // seller has rows. That bug shipped once; don't reintroduce it.

  @Get('mine')
  @UseGuards(ClerkGuard)
  mine(@CurrentUser() clerkId: string) {
    return this.listingsService.findMine(clerkId);
  }

  // Public listing detail. OptionalClerkGuard makes this owner-aware without
  // rejecting anonymous callers: if the seller's Clerk token is present,
  // @CurrentUser() resolves their id and findById adds the owner-only fields
  // (hidden reserve, auto-accept threshold, moderation-banner data) and lifts
  // the public-status gate for their own listing. Everyone else gets the
  // public projection. See ListingsService.PUBLIC_LISTING_SELECT.
  @Get(':id')
  @SkipThrottle()
  @UseGuards(OptionalClerkGuard)
  findOne(@Param('id') id: string, @CurrentUser() clerkId?: string) {
    return this.listingsService.findById(id, clerkId);
  }

  @Post()
  @UseGuards(ClerkGuard)
  create(@CurrentUser() clerkId: string, @Body() dto: CreateListingDto) {
    return this.listingsService.create(clerkId, dto);
  }

  // POST /listings/firearm-docs — pre-upload the serial + licence proof
  // photos for a firearm/barrel listing. Returns Cloudinary URLs the Sell
  // form then passes into POST /listings, where Claude vision verifies
  // them. Two named files: serialPhoto + licencePhoto.
  @Post('firearm-docs')
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'serialPhoto', maxCount: 1 },
        { name: 'licencePhoto', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } },
    ),
  )
  uploadFirearmDocs(
    @CurrentUser() clerkId: string,
    @UploadedFiles()
    files: {
      serialPhoto?: Express.Multer.File[];
      licencePhoto?: Express.Multer.File[];
    },
  ) {
    return this.listingsService.uploadFirearmDocs(
      clerkId,
      files?.serialPhoto?.[0],
      files?.licencePhoto?.[0],
    );
  }

  // POST /listings/experience-supplier-docs — pre-upload the outfitter's
  // public-liability insurance + registration proof for a hunting-package /
  // experience listing. Returns Cloudinary URLs the Sell form passes into
  // POST /listings for the admin / vision supplier-doc review. Two named
  // files: insuranceDoc + registrationDoc.
  @Post('experience-supplier-docs')
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'insuranceDoc', maxCount: 1 },
        { name: 'registrationDoc', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } },
    ),
  )
  uploadSupplierDocs(
    @CurrentUser() clerkId: string,
    @UploadedFiles()
    files: {
      insuranceDoc?: Express.Multer.File[];
      registrationDoc?: Express.Multer.File[];
    },
  ) {
    return this.listingsService.uploadSupplierDocs(
      clerkId,
      files?.insuranceDoc?.[0],
      files?.registrationDoc?.[0],
    );
  }

  // POST /listings/enhance-description — used by the "Enhance wording"
  // button on /listings/new before the listing exists. Returns the
  // rewritten text plus a flag for whether it changed. Auth-gated so
  // randoms can't burn through our Anthropic quota.
  @Post('enhance-description')
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  enhanceDescription(
    @Body()
    body: {
      description?: string;
      title?: string;
      categoryId?: string;
      make?: string;
      model?: string;
      calibre?: string;
      condition?: string;
      /** Staged photo URLs (already uploaded) — preferred, smaller payload. */
      imageUrls?: string[];
      /** Base64 photos not yet uploaded. Capped service-side at 5 total. */
      imagesBase64?: { mediaType: string; data: string }[];
    },
  ) {
    return this.listingsService.enhanceDescription(body.description ?? '', {
      title: body.title,
      categoryId: body.categoryId,
      make: body.make,
      model: body.model,
      calibre: body.calibre,
      condition: body.condition,
      imageUrls: body.imageUrls,
      imagesBase64: body.imagesBase64,
    });
  }

  // POST /listings/estimate-price — resale-value estimator for the sell form's
  // "Suggest a price" button. Auth-gated (sellers only) + throttled because it
  // can trigger one AI + web-search call on a thin-comps item. Returns an
  // INDICATIVE range only — never a valuation the platform stands behind.
  @Post('estimate-price')
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  estimatePrice(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      categoryId?: string;
      categorySlug?: string;
      make?: string;
      model?: string;
      title?: string;
      condition?: string;
    },
  ) {
    return this.priceEstimate.estimate({
      categoryId: body.categoryId,
      categorySlug: body.categorySlug,
      make: body.make,
      model: body.model,
      title: body.title,
      condition: body.condition,
      // Per-user daily web-anchor cap key (IP throttling is defeatable).
      userId: clerkId,
    });
  }

  // POST /listings/preview — dry-run the moderation pipeline against draft
  // form data without persisting anything. The Sell form "Review listing"
  // button hits this; the response drives the preview screen (greyed-out
  // preview with prohibited content highlighted, or a clean confirm-publish).
  @Post('preview')
  @UseGuards(ClerkGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  preview(
    @CurrentUser() clerkId: string,
    @Body() dto: PreviewListingDto,
  ) {
    return this.listingsService.previewDraft(clerkId, dto);
  }

  @Patch(':id')
  @UseGuards(ClerkGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, clerkId, dto);
  }

  /**
   * Cheap pre-flight: returns whether the seller can edit this
   * listing right now (bids placed? listing sold/cancelled?). The
   * /listings/[id] detail page hits this so it can hide the Edit
   * button server-side instead of trial-and-erroring on the PATCH.
   * Public read — no auth needed; the answer is the same for any
   * caller (it's not sensitive info).
   */
  @Get(':id/edit-lock')
  editLock(@Param('id') id: string) {
    return this.listingsService.getEditLockState(id);
  }

  @Delete(':id')
  @UseGuards(ClerkGuard)
  @HttpCode(204)
  cancel(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.listingsService.cancel(id, clerkId);
  }

  /**
   * "Yes, this is still for sale" — resets the stale-listing clock so the
   * daily sweep won't expire the listing at 90 days. Answers the 75-day
   * renewal nudge; owner-only, ACTIVE non-auction listings only.
   */
  @Post(':id/renew')
  @UseGuards(ClerkGuard)
  renew(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.listingsService.renew(id, clerkId);
  }

  @Post(':id/images')
  @UseGuards(ClerkGuard)
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  addImage(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.listingsService.addImage(id, clerkId, file);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(ClerkGuard)
  @HttpCode(204)
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() clerkId: string,
  ) {
    return this.listingsService.removeImage(id, imageId, clerkId);
  }
}
