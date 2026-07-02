import { IsString, IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingType, Condition, Province } from '@prisma/client';

export class BrowseListingsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsEnum(ListingType)
  listingType?: ListingType;

  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  // Brand / manufacturer facet (e.g. "Glock", "CZ"). Matched exactly against
  // Listing.make — values come from GET /listings/brands so they line up.
  @IsOptional()
  @IsString()
  make?: string;

  // P5.7 — brand-landing-page filter. A slugified make ("front-runner"). The
  // service folds every casing variant that slugifies to this value into one
  // `make IN (...)` filter, so the brand page and its sitemap/gate all agree
  // on the same listing set. Prisma path only (brand pages never combine q).
  @IsOptional()
  @IsString()
  brandSlug?: string;

  // Filter to a single seller's listings (public — used by the
  // seller-profile page to show "this seller's active listings").
  // We accept Clerk's ID here because that's what the public URLs
  // use; the service resolves it to the local User.id internally.
  @IsOptional()
  @IsString()
  sellerClerkId?: string;

  /** Comma-separated cuid list. When set, returns ONLY the matching
   * listings preserving the order of the input list. Powers the
   * recently-viewed rail on the homepage — frontend stores the last
   * N viewed listing IDs in localStorage and asks for their fresh
   * data here. Skips all other filters except the ACTIVE status gate.
   * Max 50 IDs per request — caller responsible for slicing. */
  @IsOptional()
  @IsString()
  ids?: string;

  // ZAR cents
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest' = 'newest';

  /**
   * P4.3a — per-category attribute filters, JSON-encoded by the client.
   * Two clause shapes are supported per attribute key:
   *   - equality:  { "battery_chemistry": "LiFePO4", "new_with_tags": true }
   *   - range:     { "capacity_litres": { "min": 30, "max": 60 } }
   * Values may be number | string | boolean, or a { min?, max? } object of
   * numbers for ranges. Parsed + heavily sanitized in the service; a
   * malformed blob is ignored. Attribute filtering is Meilisearch-only —
   * the Prisma fallback does NOT apply these (documented degradation when
   * Meili is down).
   */
  @IsOptional()
  @IsString()
  attrs?: string;
}
