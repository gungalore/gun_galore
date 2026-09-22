import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FEED_MAX_BODY, FEED_MAX_TAGS, FEED_MAX_TITLE } from '../feed.types';

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
}
