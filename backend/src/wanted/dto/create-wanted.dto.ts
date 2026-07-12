import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Province } from '@prisma/client';

export class CreateWantedDto {
  @IsString()
  @MinLength(5)
  @MaxLength(90)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  // Optional "willing to pay around" band, ZAR cents. Display-only — no
  // money moves on a wanted ad. R1m cap keeps typo'd budgets out of the UI.
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100_000_000)
  budgetMinCents?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(100_000_000)
  budgetMaxCents?: number;
}
