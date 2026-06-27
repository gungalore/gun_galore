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
}
