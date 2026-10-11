import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Strip C0/C1 control characters but keep normal whitespace. Shared by the
 * intake fields so every free-text column gets the same cleaning.
 */
export function stripControlChars(value: unknown): unknown {
  return typeof value === 'string'
    ? // strip C0/C1 control characters, keep normal whitespace
      // eslint-disable-next-line no-control-regex
      value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : value;
}

/**
 * Intake body. `itemName` and `description` are both optional here: the
 * valuation row is created on the first photo upload, which can happen before
 * the member has typed anything. The name is enforced as required at the
 * identify step instead (see IdentifyValuationDto).
 */
export class CreateValuationDto {
  @IsOptional()
  @Transform(({ value }) => stripControlChars(value))
  @IsString()
  @MaxLength(120)
  itemName?: string;

  @IsOptional()
  @Transform(({ value }) => stripControlChars(value))
  @IsString()
  @MaxLength(2000)
  description?: string;
}
