import {
  IsString,
  IsEnum,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  IsInt,
  Min,
  Equals,
  ValidateIf,
  ValidateNested,
  IsPostalCode,
  MinLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryOption, PaymentProvider, ShippingMethod } from '@prisma/client';

export class DeliveryAddressDto {
  // Optional complex / unit / building identifier â€” same as ManualAddressFields.
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

  // Contact name + phone deliberately NOT collected on this DTO â€” the
  // backend pulls them from User.firstName/lastName + User.phone when
  // building the carrier shipment request. This keeps the checkout form
  // smaller and means the buyer can't accidentally ship to a typo'd
  // phone number.

  // Coords are optional here â€” they're not required to BOOK a shipment,
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

  // Which gateway receives the buyer's money. Optional for backward
  // compatibility (defaults to Ozow); once set on the Transaction it is
  // immutable and every refund/payout follows it.
  @IsOptional()
  @IsEnum(PaymentProvider)
  paymentProvider?: PaymentProvider;

  // When checking out from an accepted offer on a Buy Now or Auction
  // listing. (TAKE_A_SHOT is accepted only for legacy rows.)
  @IsOptional()
  @IsString()
  offerId?: string;

  @IsEnum(ShippingMethod)
  shippingMethod: ShippingMethod;

  // Courier: buyer delivery address
  @ValidateIf((o) => o.shippingMethod === 'COURIER')
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  // Courier: keep this address in the buyer's address book. Defaults to true —
  // an address typed at checkout is one the buyer will want again — so only an
  // explicit `false` opts out.
  @IsOptional()
  @IsBoolean()
  saveDeliveryAddress?: boolean;

  // Courier: make the saved address (new OR existing) the buyer's default.
  // The checkout asks this question only when the typed address is not
  // already their default; the server enforces one default per member.
  @IsOptional()
  @IsBoolean()
  makeDeliveryAddressDefault?: boolean;

  // Courier menu choice. Server re-quotes and resolves the selected kind; the
  // buyer never supplies or controls a shipping price. STORE_PICKUP additionally
  // carries the exact Pargo counter id selected from Bob Go's returned list.
  @ValidateIf((o) => o.shippingMethod === 'COURIER')
  @IsOptional()
  @IsEnum(DeliveryOption)
  deliveryOption?: DeliveryOption;

  @ValidateIf((o) => o.shippingMethod === 'COURIER' && o.deliveryOption === 'STORE_PICKUP')
  @IsInt()
  @Min(1)
  pickupPointLocationId?: number;

  // Dealer transfer: buyer's chosen receiving dealer. OPTIONAL â€” the
  // dealer dropdown was removed from checkout (the buyer nominates any
  // SAPS-licensed dealer after the sale, and payout is gated by
  // DealerVerificationService on the SAPS 534 stock-in, not by a
  // pre-selected dealerId). TransactionsService only looks a dealer up
  // when one is supplied, so requiring it here just 400'd the default
  // firearm DEALER_TRANSFER checkout before it could reach the paygate.
  @IsOptional()
  @IsString()
  dealerId?: string;

  // PRIVATE_ARRANGE: explicit consent flag. The buyer accepts the in-person
  // handover terms (payment held until confirmation, contact sharing and the
  // non-refundable Platform Fee) with the Terms of Service at registration, so
  // checkout carries no consent screen; the client still sends `true` on every
  // PRIVATE_ARRANGE line. Must be `true` (not just present) for PRIVATE_ARRANGE
  // submissions: the controller / service refuses the transaction without it,
  // so a direct API caller can't accidentally trigger an immediate payout.
  @ValidateIf((o) => o.shippingMethod === 'PRIVATE_ARRANGE')
  @IsBoolean()
  @Equals(true, {
    message:
      'Private arrangement requires acceptance of the Terms of Service.',
  })
  privateArrangeConsent?: boolean;

  // M33 â€” 18+/competency attestation for firearm checkouts. The flag
  // must be explicitly `true` (not `undefined`, not `false`) when the
  // listing is a firearm. The service re-checks `listing.isFirearm`
  // server-side and refuses the transaction if the flag isn't true on
  // a firearm listing â€” defence in depth against the frontend gate
  // being bypassed. Stored as `firearmAttestationAcceptedAt` on the
  // Transaction so we have durable evidence the buyer affirmed at
  // checkout (dispute defence + SAPS audit trail).
  @IsOptional()
  @IsBoolean()
  firearmAttestation18Plus?: boolean;

  // P3 â€” collection papers acknowledgement for trailer / caravan checkouts.
  // Must be explicitly `true` when the listing has requiresPapers. The
  // service re-checks `listing.requiresPapers` server-side and refuses the
  // transaction without it (defence in depth). Persisted as
  // `collectionPapersAckAt` on the Transaction for dispute/audit evidence.
  @IsOptional()
  @IsBoolean()
  collectionPapersAccepted?: boolean;

  // Location / no-refund terms are accepted in the Terms of Service at
  // registration. This stays optional for older clients.
  @IsOptional()
  @IsBoolean()
  buyerTermsAccepted?: boolean;

  // Units to buy (Phase 8a). Only honoured for inventory-tracked BUY_NOW
  // listings; ignored (resolved to 1) for every other listing. Defaults
  // to 1 when omitted.
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  // The 15-minute checkout hold created when the buyer opened the checkout
  // page (POST /transactions/hold). Optional so token/legacy callers that never
  // held still work: without it the old reserve-at-Pay path runs unchanged.
  @IsOptional()
  @IsString()
  holdId?: string;

  // â”€â”€â”€ Hunting Packages / Experiences (EXP-E1) buyer attestations â”€â”€â”€â”€â”€â”€
  // Five booleans the buyer must tick at experience checkout. The service
  // re-checks listing.isExperience server-side and HARD-refuses the
  // transaction unless every one is explicitly `true` (defence in depth over
  // the frontend gate), persisting a *At evidence stamp for each â€” mirrors the
  // firearm 18+ attestation. @IsOptional here so non-experience checkouts are
  // unaffected; the experience branch enforces presence + truthiness.
  @IsOptional()
  @IsBoolean()
  experienceBuyerAttested18Plus?: boolean;

  @IsOptional()
  @IsBoolean()
  experienceHuntingLicenceOrSupervisionAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  experienceIntermediaryAcknowledged?: boolean;

  @IsOptional()
  @IsBoolean()
  experienceCancellationPolicyAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  experienceRisksAccepted?: boolean;

  // The specific date the buyer booked â€” one of the dates the outfitter
  // offered. ISO date-time string. The service validates it falls within the
  // listing's eventStartDate..(eventEndDate ?? eventStartDate) window and is in
  // the future, then persists it as Transaction.eventDate. Required by the
  // experience branch; @IsOptional at the DTO layer so it never affects a
  // goods checkout.
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  // Guests / hunters on this booking. The service validates 1 â‰¤ partySize â‰¤
  // listing.capacitySlots and persists it as Transaction.partySize.
  @IsOptional()
  @IsInt()
  @Min(1)
  partySize?: number;
}
