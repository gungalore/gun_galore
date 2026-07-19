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
import { SWAP_CASH_MAX_CENTS } from './create-swap-proposal.dto';

export class CounterSwapDto {
  // Owner's single counter on the CASH only (the items stay the same).
  // 0 = "remove the cash, straight item-for-item". Same P0.5 ceiling +
  // cash-commission rules as the original proposal.
  @IsInt()
  @Min(0)
  @Max(SWAP_CASH_MAX_CENTS)
  counterCashAmount: number;

  // Who pays the countered cash. INITIATOR_GIVES = proposer pays owner;
  // OWNER_GIVES = owner pays proposer. Only meaningful (and only required)
  // when the countered cash is non-zero.
  @ValidateIf((o) => (o.counterCashAmount ?? 0) > 0)
  @IsEnum(SwapRole)
  counterCashDirection?: SwapRole;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ownerNote?: string;

  // S6 — required true when the OFFERED item is a firearm (the owner will
  // receive it). 18+/competency affirmation; server re-checks isFirearm.
  @IsOptional()
  @IsBoolean()
  firearmAttestation18Plus?: boolean;
}
