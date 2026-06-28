import { IsString, IsInt, IsOptional, IsEnum, Min, MaxLength } from 'class-validator';
import { SwapRole } from '@prisma/client';

export class CounterSwapDto {
  // Owner's single counter on the CASH only (the items stay the same).
  // 0 = "remove the cash, straight item-for-item".
  @IsInt()
  @Min(0)
  counterCashAmount: number;

  // Who pays the countered cash. INITIATOR_GIVES = proposer pays owner;
  // OWNER_GIVES = owner pays proposer.
  @IsEnum(SwapRole)
  counterCashDirection: SwapRole;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  ownerNote?: string;
}
