import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { ListingType, Condition, Province } from '@prisma/client';

/**
 * P5.1 — the filter set the "Save this search" button posts. Mirrors the
 * saved-search-relevant subset of BrowseListingsDto (no page/limit — those
 * are pagination, not filters). Every field is optional; the service rejects
 * an entirely-empty save (that would mean "alert me on every listing").
 */
export class CreateSavedSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
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

  @IsOptional()
  @IsString()
  @MaxLength(80)
  make?: string;

  // ZAR cents.
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
  @IsEnum(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest';

  // URL-encoded JSON of per-category attribute filters. Captured to round-trip
  // the search URL; NOT applied by the matcher (Meili-only in browse).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attrs?: string;
}
