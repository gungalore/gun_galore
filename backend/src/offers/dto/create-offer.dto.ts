import { IsString, IsInt, IsOptional, MaxLength, Min } from 'class-validator';

export class CreateOfferDto {
  @IsString()
  listingId: string;

  @IsInt()
  @Min(100)
  offerAmount: number; // ZAR cents

  @IsOptional()
  @IsString()
  @MaxLength(500)
  buyerNote?: string;
}
