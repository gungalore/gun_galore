import { IsIn, IsString } from 'class-validator';
import { FeaturedTier } from '@prisma/client';

// Buy-Now: claim a featured slot OUTRIGHT (skip the auction) at a fixed
// 2× the chosen tier's base price. The seller picks the tier (which sets
// the featured duration) + one of their ACTIVE listings up front, so the
// purchase is atomic — no separate 15-min bind window. Only valid on a
// slot that is AUCTION_RUNNING or VACANT (not one with a live occupant).
export class FeaturedBuyNowDto {
  @IsString()
  slotId: string;

  @IsIn(['T1', 'T2', 'T3', 'T4', 'T5'])
  tier: FeaturedTier;

  @IsString()
  listingId: string;
}
