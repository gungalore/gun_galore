import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LockerSearchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  // Optional 4-digit SA postal code (e.g. "7570"). When set, the
  // locker matcher tiers results by exact-match → Delaunay
  // neighbours → distance fallback. Lets users with no captured
  // coordinates still get a meaningful suggestion set.
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'postalCode must be a 4-digit SA code' })
  postalCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  radiusKm?: number = 30;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
