import { PostType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { FEED_PAGE_MAX } from '../feed.types';

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
}
