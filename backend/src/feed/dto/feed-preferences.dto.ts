import { PostType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { FEED_MAX_MUTES_PER_AXIS } from '../feed.types';

export class FeedPreferencesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_MUTES_PER_AXIS)
  @IsEnum(PostType, { each: true })
  feedMutedPostTypes?: PostType[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_MUTES_PER_AXIS)
  @IsString({ each: true })
  feedMutedAuthorIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEED_MAX_MUTES_PER_AXIS)
  @IsString({ each: true })
  feedMutedTags?: string[];

  /** Show the member's profile picture in the community. Default on. */
  @IsOptional()
  @IsBoolean()
  feedShowAvatar?: boolean;
}
