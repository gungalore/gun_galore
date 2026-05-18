import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  ValidateIf,
  ValidateNested,
  IsPostalCode,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingMethod } from '@prisma/client';

export class DeliveryAddressDto {
  @IsString()
  @IsNotEmpty()
  streetAddress: string;

  @IsString()
  @IsNotEmpty()
  suburb: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsString()
  @MinLength(4)
  postalCode: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsString()
  @IsNotEmpty()
  contactPhone: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;
}

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @IsEnum(ShippingMethod)
  shippingMethod: ShippingMethod;

  // Pudo: buyer's chosen pick-up locker
  @ValidateIf((o) => o.shippingMethod === 'PUDO')
  @IsString()
  @IsNotEmpty()
  pudoPickupLockerId?: string;

  // TCG: buyer delivery address
  @ValidateIf((o) => o.shippingMethod === 'TCG')
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  // Dealer transfer: buyer's chosen receiving dealer
  @ValidateIf((o) => o.shippingMethod === 'DEALER_TRANSFER')
  @IsString()
  @IsNotEmpty()
  dealerId?: string;
}
