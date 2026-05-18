import {
  IsString,
  IsInt,
  IsEnum,
  IsBoolean,
  IsOptional,
  Min,
  Length,
  MaxLength,
} from 'class-validator';
import { ListingType, Condition, Province } from '@prisma/client';

export class CreateListingDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  description: string;

  // Price in ZAR cents (e.g., R1,500 = 150000)
  @IsInt()
  @Min(100)
  price: number;

  @IsEnum(ListingType)
  listingType: ListingType;

  @IsString()
  categoryId: string;

  @IsEnum(Condition)
  condition: Condition;

  @IsEnum(Province)
  province: Province;

  @IsBoolean()
  passFeeToBuyer: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  calibre?: string;

  // ZAR cents; Take a Shot only — must be less than price
  @IsOptional()
  @IsInt()
  @Min(100)
  autoAcceptThreshold?: number;
}
