import { IsString, MaxLength, MinLength } from 'class-validator';
import { FeedQueryDto } from './feed-query.dto';

export class FeedSearchDto extends FeedQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  q!: string;
}
