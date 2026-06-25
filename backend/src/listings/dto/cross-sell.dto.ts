import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query for GET /listings/cross-sell — the "you might also need…" engine.
 * Two entry modes (provide one):
 *   - listingId : a listing-detail page → complements for that item.
 *   - fromCategoryId + q : a search/browse results page → complements for
 *     the active category + the user's query (for the calibre signal).
 * excludeIds: comma-separated ids already on the user's screen, so the
 * suggestion row never repeats what they're already looking at.
 */
export class CrossSellDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  listingId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excludeIds?: string;
}
