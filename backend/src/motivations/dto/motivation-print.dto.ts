import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Province } from '@prisma/client';

/** The delivery address the member typed or picked for a printed copy. */
export class PrintDeliveryAddressDto {
  @IsString()
  @IsNotEmpty()
  streetAddress: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsString()
  @IsNotEmpty()
  suburb: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  postalCode: string;

  @IsEnum(Province)
  province: Province;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

/** `POST /motivations/:id/print/quote` */
export class PrintQuoteDto {
  @ValidateNested()
  @Type(() => PrintDeliveryAddressDto)
  address: PrintDeliveryAddressDto;
}

/** `POST /motivations/:id/payment` — address only when fulfilment is DELIVER. */
export class MotivationPaymentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDeliveryAddressDto)
  address?: PrintDeliveryAddressDto;
}

/** `PATCH /motivations/:id/fulfilment` — the second choice. */
export class SetFulfilmentDto {
  @IsIn(['DIGITAL', 'DELIVER'])
  mode: 'DIGITAL' | 'DELIVER';
}
