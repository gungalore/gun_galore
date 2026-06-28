import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingMethod } from '@prisma/client';
import { DeliveryAddressDto } from './create-transaction.dto';

// One line of a multi-item cart. A subset of CreateTransactionDto — the cart
// only carries standard BUY_NOW non-firearm items, so there is NO offerId,
// dealerId, privateArrangeConsent or firearm attestation here (those flows
// stay single-item). Each line still picks its own shipping method + target,
// because shipping is per-listing (per-parcel) on the platform.
export class CreateOrderLineDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @IsEnum(ShippingMethod)
  shippingMethod: ShippingMethod;

  @ValidateIf((o) => o.shippingMethod === 'PUDO')
  @IsString()
  @IsNotEmpty()
  pudoPickupLockerId?: string;

  @ValidateIf((o) => o.shippingMethod === 'TCG')
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20) // sane cap; a single-seller cart shouldn't exceed this
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines: CreateOrderLineDto[];
}
