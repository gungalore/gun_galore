import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FEED_MAX_COMMENT } from '../feed.types';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(FEED_MAX_COMMENT)
  body!: string;

  /** Set to reply to a comment; omit for a top-level comment. */
  @IsOptional()
  @IsString()
  parentId?: string;
}
