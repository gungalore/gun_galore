import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  FEED_MAX_BODY,
  FEED_MAX_CHIPS,
  FEED_MAX_TAGS,
  FEED_MAX_TITLE,
  POST_NUMERIC_BOUNDS,
} from '../feed.types';

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(FEED_MAX_TITLE)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(FEED_MAX_BODY)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_TAGS)
  @IsString({ each: true })
  tags?: string[];

  // ── Optional per-category detail fields (see CreatePostDto) ───────────────
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_CHIPS)
  @IsString({ each: true })
  flair?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_CHIPS)
  @IsString({ each: true })
  species?: string[];

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  calibre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  firearmType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  firearmModel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.bulletWeightGr.min)
  @Max(POST_NUMERIC_BOUNDS.bulletWeightGr.max)
  bulletWeightGr?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.powderChargeGr.min)
  @Max(POST_NUMERIC_BOUNDS.powderChargeGr.max)
  powderChargeGr?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  testResult?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  waterType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.sizeCm.min)
  @Max(POST_NUMERIC_BOUNDS.sizeCm.max)
  sizeCm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.shotDistanceM.min)
  @Max(POST_NUMERIC_BOUNDS.shotDistanceM.max)
  shotDistanceM?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  siteType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.tripDays.min)
  @Max(POST_NUMERIC_BOUNDS.tripDays.max)
  tripDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gearCategory?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(POST_NUMERIC_BOUNDS.gearRating.min)
  @Max(POST_NUMERIC_BOUNDS.gearRating.max)
  gearRating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gearCondition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  context?: string;
}
