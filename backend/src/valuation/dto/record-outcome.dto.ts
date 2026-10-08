import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordOutcomeDto {
  @IsString()
  listingId!: string;

  /** Optional: what the item actually sold for, in cents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  soldPriceCents?: number;

  /** Optional ISO date the sale completed. */
  @IsOptional()
  @IsString()
  soldAt?: string;
}
