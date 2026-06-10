import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  Equals,
  ValidateIf,
  ValidateNested,
  IsPostalCode,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShippingMethod } from '@prisma/client';

export class DeliveryAddressDto {
  // Optional complex / unit / building identifier — same as ManualAddressFields.
  @IsOptional()
  @IsString()
  building?: string;

  @IsString()
  @IsNotEmpty()
  streetAddress: string;

  // Optional second address line (e.g. "Apt 4B", "Behind reception").
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
  province: string;

  @IsString()
  @MinLength(4)
  postalCode: string;

  // Contact name + phone deliberately NOT collected on this DTO — the
  // backend pulls them from User.firstName/lastName + User.phone when
  // building the TCG shipment request. This keeps the checkout form
  // smaller and means the buyer can't accidentally ship to a typo'd
  // phone number.

  // Coords are optional here — they're not required to BOOK a shipment,
  // only to QUOTE one (and the quote-time call passes them separately).
  @IsOptional()
  lat?: number;

  @IsOptional()
  lng?: number;
}

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  listingId: string;

  // When checking out from an accepted offer (TAKE_A_SHOT)
  @IsOptional()
  @IsString()
  offerId?: string;

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

  // PRIVATE_ARRANGE: explicit consent flag — the buyer ticked both
  // boxes and typed "I UNDERSTAND" on the consent screen. Must be
  // `true` (not just present) for PRIVATE_ARRANGE submissions. The
  // controller / service refuses the transaction without it, so a
  // direct API caller can't accidentally trigger an immediate payout.
  @ValidateIf((o) => o.shippingMethod === 'PRIVATE_ARRANGE')
  @IsBoolean()
  @Equals(true, {
    message:
      'Private arrangement requires explicit consent — tick the boxes on the checkout screen.',
  })
  privateArrangeConsent?: boolean;

  // M33 — 18+/competency attestation for firearm checkouts. The flag
  // must be explicitly `true` (not `undefined`, not `false`) when the
  // listing is a firearm. The service re-checks `listing.isFirearm`
  // server-side and refuses the transaction if the flag isn't true on
  // a firearm listing — defence in depth against the frontend gate
  // being bypassed. Stored as `firearmAttestationAcceptedAt` on the
  // Transaction so we have durable evidence the buyer affirmed at
  // checkout (dispute defence + SAPS audit trail).
  @IsOptional()
  @IsBoolean()
  firearmAttestation18Plus?: boolean;
}
