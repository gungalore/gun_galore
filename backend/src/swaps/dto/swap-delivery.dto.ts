import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  MaxLength,
  Length,
} from 'class-validator';
import { Province } from '@prisma/client';

// Each swap party supplies the address where THEY receive the other party's
// item (the leg they're the recipient of). v1 ships door-to-door, so a street
// address is all that's needed — no locker selection. Mirrors the listing
// pickup-address fields.
export class SwapDeliveryDto {
  @IsOptional() @IsString() @MaxLength(120) building?: string;

  @IsString() @Length(3, 200) street: string;

  @IsOptional() @IsString() @MaxLength(200) address2?: string;

  @IsString() @Length(2, 120) suburb: string;

  @IsString() @Length(2, 120) city: string;

  @IsString() @Length(4, 10) postalCode: string;

  @IsEnum(Province) province: Province;

  // Optional coords from address autocomplete — improve the TCG D2D rate.
  // Fall back to 0 (matches the marketplace checkout) when absent.
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
}
