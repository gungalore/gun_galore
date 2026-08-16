import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsInt,
  IsBoolean,
  Equals,
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

// One line of a multi-item cart. A subset of CreateTransactionDto. BUY_NOW
// only (auctions / swaps / offer items stay single-item), but as of P6-A a
// firearm BUY_NOW line MAY ride in the cart: it never courier-ships and never
// consolidates — it branches to its own DEALER_TRANSFER or PRIVATE_ARRANGE
// route after payment, exactly like a single-item firearm buy. So the firearm
// fields (attestation + in-person consent + optional dealer) live here too,
// validated the same way the single-item DTO validates them. Each line still
// picks its own shipping method + target, because shipping is per-listing.
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

  // Firearm DEALER_TRANSFER: buyer's chosen receiving dealer. OPTIONAL — the
  // buyer nominates any SAPS-licensed dealer after the sale and payout is gated
  // on the DealerVerificationService stock-in, not a pre-picked dealerId.
  @IsOptional()
  @IsString()
  dealerId?: string;

  // PRIVATE_ARRANGE ("arrange in person"): explicit consent flag. Must be
  // `true` for a firearm in-person line — the service refuses the line and its
  // immediate payout without it (defence in depth over the frontend consent
  // screen). Mirrors CreateTransactionDto.privateArrangeConsent.
  @ValidateIf((o) => o.shippingMethod === 'PRIVATE_ARRANGE')
  @IsBoolean()
  @Equals(true, {
    message:
      'Private arrangement requires explicit consent — tick the boxes on the checkout screen.',
  })
  privateArrangeConsent?: boolean;

  // M33 — 18+/competency attestation. The service re-checks listing.isFirearm
  // server-side and refuses the line if this isn't true on a firearm listing.
  // Non-firearm lines ignore it. Mirrors CreateTransactionDto.
  @IsOptional()
  @IsBoolean()
  firearmAttestation18Plus?: boolean;

  // Collection papers acknowledgement (trailer / caravan). Was missing here,
  // which made a requiresPapers listing unbuyable from the cart: the service
  // gate demands it, the line had no way to carry it, and the failure was
  // masked only because the one requiresPapers category is also collectionOnly
  // and the cart rejects those earlier. Mirrors CreateTransactionDto.
  @IsOptional()
  @IsBoolean()
  collectionPapersAccepted?: boolean;

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

  // On the ORDER, not on each line: one tick covers the whole cart, and the
  // cart screen lists every item's town above it. Putting it per-line would
  // ask the buyer to agree to the same sentence N times.
  //
  // MUST be mirrored into the per-line CreateTransactionDto that
  // transactions.service builds for each line — that mapping is an explicit
  // field list with an `as CreateTransactionDto` cast, so a field missed there
  // compiles cleanly and fails at runtime on every single order.
  @IsBoolean()
  @Equals(true, {
    message:
      'You must confirm you have seen where these items are and that location is not a refund ground.',
  })
  buyerTermsAccepted!: boolean;
}
