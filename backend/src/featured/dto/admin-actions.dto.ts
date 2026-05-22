import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

// Admin force-evict a current occupant. `refund` = whether to call
// Peach for a full refund of the bid that paid for the slot. Reason
// is required so the audit log has context.
export class ForceEvictDto {
  @IsString()
  @Length(3, 500)
  reason: string;

  @IsOptional()
  @IsBoolean()
  refund?: boolean; // defaults to false at the service layer
}

// Admin manually awards a slot to a specific listing for free (no bid,
// no Peach charge). Used for cross-promo, comp prizes, system listings.
// The listing must exist + be ACTIVE; service validates.
export class ManualAwardDto {
  @IsString()
  listingId: string;

  @IsInt()
  @Min(1)
  durationSeconds: number;

  @IsString()
  @Length(3, 500)
  reason: string;
}

// Admin extends or shortens a current occupant's featuredUntil by
// `deltaSeconds` (signed — positive = extend, negative = shorten).
export class ShiftFeaturedUntilDto {
  @IsInt()
  deltaSeconds: number;

  @IsString()
  @Length(3, 500)
  reason: string;
}

// Admin closes the currently OPEN auction on a slot early. Whatever's
// the highest bid right now wins (or NO_BIDS if none).
export class CloseAuctionEarlyDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

// Admin updates the config singleton. All fields optional — only
// supplied ones overwrite.
export class UpdateFeaturedConfigDto {
  @IsOptional() @IsInt() @Min(1) slotCount?: number;
  @IsOptional() @IsInt() @Min(100) bidFloorCents?: number;
  @IsOptional() @IsInt() @Min(100) t1AmountCents?: number;
  @IsOptional() @IsInt() @Min(60) t1DurationSec?: number;
  @IsOptional() @IsInt() @Min(100) t2AmountCents?: number;
  @IsOptional() @IsInt() @Min(60) t2DurationSec?: number;
  @IsOptional() @IsInt() @Min(100) t3AmountCents?: number;
  @IsOptional() @IsInt() @Min(60) t3DurationSec?: number;
  @IsOptional() @IsInt() @Min(100) t4AmountCents?: number;
  @IsOptional() @IsInt() @Min(60) t4DurationSec?: number;
  @IsOptional() @IsInt() @Min(100) t5AmountCents?: number;
  @IsOptional() @IsInt() @Min(60) t5DurationSec?: number;
  @IsOptional() @IsInt() @Min(60) scheduledAuctionSec?: number;
  @IsOptional() @IsInt() @Min(60) adHocAuctionSec?: number;
  @IsOptional() @IsInt() @Min(60) bindWindowSec?: number;
}

// Admin bans a user from featured-slot bidding.
export class BanFeaturedBidderDto {
  @IsString()
  userId: string;

  @IsString()
  @Length(3, 500)
  reason: string;
}
