import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CounterOfferDto {
  @IsInt()
  @Min(100)
  counterAmount: number; // ZAR cents

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sellerNote?: string;
}
