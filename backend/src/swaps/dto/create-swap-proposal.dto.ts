import {
  IsString,
  IsInt,
  IsOptional,
  IsEnum,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SwapRole } from '@prisma/client';

export class CreateSwapProposalDto {
  // The SWOP listing the proposer wants (the owner's item).
  @IsString()
  listingId: string;

  // ONE of the proposer's own SWOP listings, offered in exchange. v1
  // reuses an existing listing so its photos + firearm/licence gating
  // are already in place.
  @IsString()
  offeredListingId: string;

  // Optional cash top-up (ZAR cents). 0 = pure item-for-item.
  @IsOptional()
  @IsInt()
  @Min(0)
  cashAmount?: number;

  // Who pays the cash top-up. Required only when cashAmount > 0.
  // INITIATOR_GIVES = the proposer pays the owner; OWNER_GIVES = the
  // owner pays the proposer.
  @ValidateIf((o) => (o.cashAmount ?? 0) > 0)
  @IsEnum(SwapRole)
  cashDirection?: SwapRole;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proposerNote?: string;
}
