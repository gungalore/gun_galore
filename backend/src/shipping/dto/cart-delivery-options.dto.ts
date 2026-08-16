import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber } from 'class-validator';
import { Province } from '@prisma/client';

/**
 * The destination. Stricter than the shared DeliveryAddressDto, which types
 * `province` as a bare string: the quoting path needs a real Province enum
 * value, and a province that only fails at the carrier is a wasted round trip
 * and an unhelpful error.
 */
export class CartDeliveryAddressDto {
  @IsString()
  @IsNotEmpty()
  streetAddress!: string;

  @IsString()
  @IsNotEmpty()
  suburb!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  postalCode!: string;

  @IsEnum(Province)
  province!: Province;

  // Optional: Bob Go prices off the address, not coordinates.
  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

/**
 * Body for POST /shipping/delivery-options/cart.
 *
 * A REAL DTO CLASS, not an inline body type. The global ValidationPipe runs
 * with `whitelist: true`, and an inline `@Body() body: { ... }` type is erased
 * at runtime — so the sibling single-listing route validates nothing at all
 * today and an unshaped body reaches the service. This one is checked.
 */
export class CartDeliveryLineDto {
  @IsString()
  @IsNotEmpty()
  listingId!: string;

  /** Units of this listing. Changes the stacked parcel, so it changes price. */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CartDeliveryOptionsDto {
  @IsArray()
  @ArrayMinSize(1)
  // Mirrors CreateOrderDto's cap so a cart that can be checked out can always
  // also be quoted.
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CartDeliveryLineDto)
  lines!: CartDeliveryLineDto[];

  @ValidateNested()
  @Type(() => CartDeliveryAddressDto)
  deliveryAddress!: CartDeliveryAddressDto;
}
