import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Optional free text on the intake screen. Untrusted: capped here and
 * control-char stripped before it is ever interpolated into a prompt.
 */
export class CreateValuationDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? // strip C0/C1 control characters, keep normal whitespace
        value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      : value,
  )
  @IsString()
  @MaxLength(2000)
  description?: string;
}
