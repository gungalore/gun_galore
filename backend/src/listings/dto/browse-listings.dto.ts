import { IsString, IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ListingType, Condition, Province } from '@prisma/client';

// Multi-select filters — listingType / condition / province. A query value
// may be a single enum member ("BUY_NOW") or several comma-joined
// ("BUY_NOW,AUCTION"), so a buyer can tick both Buy Now AND Auctions, two
// provinces, or two conditions at once. This turns either shape (and the
// array Nest hands us for a repeated `?listingType=A&listingType=B` query)
// into a flat string[] BEFORE @IsEnum(..., { each: true }) validates every
// element individually — one bad value in the list still 400s the whole
// request rather than being silently dropped. Blank entries (stray commas,
// an empty string) are dropped; if nothing is left we return undefined so
// @IsOptional continues to treat "no filter" as before.
function splitCsv(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : [value];
  const parts = raw
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return parts.length > 0 ? parts : undefined;
}

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

  // Comma-separated: `?listingType=BUY_NOW,AUCTION`. A bare single value
  // (`?listingType=BUY_NOW`) still works exactly as before — it becomes a
  // one-element array, which both browseViaPrisma's `in` clause and
  // browseViaSearch's Meilisearch filter treat identically to the old
  // equality check.
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsEnum(ListingType, { each: true })
  listingType?: ListingType[];

  // Comma-separated: `?condition=NEW,LIKE_NEW`. See listingType above.
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsEnum(Condition, { each: true })
  condition?: Condition[];

  // Comma-separated: `?province=GAUTENG,WESTERN_CAPE`. See listingType above.
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsEnum(Province, { each: true })
  province?: Province[];

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

  // 'ending_soon' orders by endTime ascending with nulls last — the sort the
  // Auctions surface actually wants (a buyer browsing auctions is shopping by
  // urgency, not by listing date). Prisma-path only: the Meili document does
  // not carry endTime, so the browse layer falls back to the DB for it.
  @IsOptional()
  @IsEnum(['price_asc', 'price_desc', 'newest', 'ending_soon'])
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'ending_soon' = 'newest';

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
