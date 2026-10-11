import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { stripControlChars } from './create-valuation.dto';

/**
 * Identify body. The member must name the item before we spend a model call on
 * it: the name is what tells the valuation which item on the table is for sale,
 * so it is required here even though it is optional at create time.
 */
export class IdentifyValuationDto {
  @Transform(({ value }) => {
    const cleaned = stripControlChars(value);
    return typeof cleaned === 'string' ? cleaned.trim() : cleaned;
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  itemName!: string;

  @IsOptional()
  @Transform(({ value }) => stripControlChars(value))
  @IsString()
  @MaxLength(2000)
  description?: string;
}
