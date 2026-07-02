import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SwapRole } from '@prisma/client';

// P0.5 — sanity ceiling on the cash top-up (R500,000). The cash component
// above R1,000 now carries standard commission (see fee.calculator
// swapCashCommission), so the old commission-dodge is closed; this cap just
// bounds GG's held-funds exposure on a single swap.
export const SWAP_CASH_MAX_CENTS = 50_000_000;

export class CreateSwapProposalDto {
  // The SWOP listing the proposer wants (the owner's item).
  @IsString()
  listingId: string;

  // ONE of the proposer's own SWOP listings, offered in exchange. v1
  // reuses an existing listing so its photos + firearm/licence gating
  // are already in place.
  @IsString()
  offeredListingId: string;

  // Optional cash top-up (ZAR cents). 0 = pure item-for-item. Above
  // R1,000 the excess carries standard commission at settlement.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SWAP_CASH_MAX_CENTS)
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

  // S6 — required true when the WANTED item is a firearm (the proposer will
  // receive it). 18+/competency affirmation; server re-checks isFirearm.
  @IsOptional()
  @IsBoolean()
  firearmAttestation18Plus?: boolean;
}
