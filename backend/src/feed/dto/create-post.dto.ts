import { PostType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FEED_MAX_BODY, FEED_MAX_TAGS, FEED_MAX_TITLE } from '../feed.types';

export class CreatePostDto {
  @IsEnum(PostType)
  type!: PostType;

  @IsOptional()
  @IsString()
  @MaxLength(FEED_MAX_TITLE)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(FEED_MAX_BODY)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_TAGS)
  @IsString({ each: true })
  tags?: string[];

  /** Optional structured gear/context fields (free-form for now). */
  @IsOptional()
  gear?: Record<string, unknown>;

  /** Optional link to a marketplace listing the post is about. */
  @IsOptional()
  @IsString()
  listingId?: string;

  /** Optional catalogue category tag. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Optional topic group the post belongs to. */
  @IsOptional()
  @IsString()
  groupId?: string;

  /** Optional location from Google Places autocomplete. */
  @IsOptional()
  @IsString()
  location?: string;
}
