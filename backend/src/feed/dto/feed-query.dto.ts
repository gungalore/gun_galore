import { PostType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FEED_MAX_CHIPS, FEED_PAGE_MAX } from '../feed.types';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class FeedQueryDto {
  /** ISO date of the last row's createdAt, for cursor "load more". */
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEED_PAGE_MAX)
  limit?: number;

  /** Show everything, with muted items marked. Never persisted. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeFiltered?: boolean;

  /** Restrict to one post type. */
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

  /** Restrict to posts tagged with any of these species (Hunting/Fishing). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_CHIPS)
  @IsString({ each: true })
  species?: string[];

  /** Restrict to a calibre / cartridge (Hunting, Firearms, Reloading). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  calibre?: string;

  /** Minimum star rating (Gear & Reviews). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minRating?: number;
}
