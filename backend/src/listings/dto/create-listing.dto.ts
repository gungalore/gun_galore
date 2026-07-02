import {
  IsString,
  IsInt,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsIn,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ListingType, Condition, Province, ShippingMethod } from '@prisma/client';

export class CreateListingDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  description: string;

  // Required for BUY_NOW and AUCTION; omit for TAKE_A_SHOT and SWOP (both
  // price-less — buyers name a price / a swap has no sale price).
  @ValidateIf((o) => o.listingType !== 'TAKE_A_SHOT' && o.listingType !== 'SWOP')
  @IsInt()
  @Min(100)
  price?: number; // ZAR cents

  @IsEnum(ListingType)
  listingType: ListingType;

  @IsString()
  categoryId: string;

  @IsEnum(Condition)
  condition: Condition;

  @IsEnum(Province)
  province: Province;

  @IsBoolean()
  passFeeToBuyer: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  calibre?: string;

  // ---- Firearm/barrel licence + serial -------------------------------
  // Required when the category is a firearm/barrel (enforced in
  // ListingsService.create). The seller types the serial; the serial +
  // licence proof photos are uploaded to Cloudinary BEFORE create, and
  // their URLs are passed here so Claude vision can verify at create time
  // that (a) the photo's serial matches the typed serial, (b) the
  // licence's serial matches it, (c) the licence holder matches the
  // seller, and (d) the licence isn't expired / inside 30 days.
  @IsOptional() @IsString() @MaxLength(60) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) serialPhotoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) licencePhotoUrl?: string;

  // ZAR cents; TAKE_A_SHOT only — auto-accepts offers at or above this amount
  @IsOptional()
  @IsInt()
  @Min(100)
  autoAcceptThreshold?: number;

  // ---- AUCTION-only fields ----------------------------------------
  // Hidden reserve in ZAR cents. Optional.
  @IsOptional()
  @IsInt()
  @Min(100)
  reservePrice?: number;

  // Buy Now price in ZAR cents. Available only while bidCount is 0.
  @IsOptional()
  @IsInt()
  @Min(100)
  buyNowPrice?: number;

  // Auction duration in days. Required for AUCTION listings.
  @ValidateIf((o) => o.listingType === 'AUCTION')
  @IsInt()
  @IsIn([3, 5, 7, 14])
  durationDays?: number;

  // Paid placement (R150). Snapshot only — billing handled separately.
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  // ---- Delivery + pickup address ---------------------------------------
  // At least one shipping method is required. For non-firearm categories
  // the valid values are PUDO + TCG; for firearms/barrels they are
  // DEALER_TRANSFER + PRIVATE_ARRANGE. The listings service additionally
  // enforces that firearm listings MUST include DEALER_TRANSFER (per
  // SAPS regulation + platform policy 2026-05-26).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(ShippingMethod, { each: true })
  shippingMethods?: ShippingMethod[];

  // Optional seller-supplied hint of where they intend to dealer-stock
  // this firearm. Free text, max 200 chars. Ignored for non-firearm
  // listings. Shown to buyers on the listing detail page.
  @IsOptional() @IsString() @MaxLength(200) plannedDealerLocation?: string;

  // P3 — papers attestation for NaTIS-registered goods (trailers / off-road
  // caravans). Must be explicitly true when the category has requiresPapers;
  // ListingsService.create re-checks the category flag server-side and
  // refuses without it. Boolean only — we never collect or store the actual
  // registration documents (POPIA). NOT a Listing column — update() strips it.
  @IsOptional()
  @IsBoolean()
  collectionPapersAttested?: boolean;

  @IsOptional() @IsString() @MaxLength(120) pickupBuilding?: string;
  @IsOptional() @IsString() @MaxLength(200) pickupStreet?: string;
  @IsOptional() @IsString() @MaxLength(200) pickupAddress2?: string;
  @IsOptional() @IsString() @MaxLength(120) pickupSuburb?: string;
  @IsOptional() @IsString() @MaxLength(120) pickupCity?: string;
  @IsOptional() @IsString() @MaxLength(10) pickupPostalCode?: string;
  @IsOptional() @IsNumber() pickupLat?: number;
  @IsOptional() @IsNumber() pickupLng?: number;
  // Set when the seller picks (or we auto-suggest) a Pudo drop-off locker.
  @IsOptional() @IsString() @MaxLength(60) pickupPudoLockerId?: string;

  // Parcel weight + dimensions for the courier rate API. Required for
  // non-firearm listings (validated at app level in ListingsService); the
  // DTO marks them optional so a firearm listing can still submit cleanly.
  @IsOptional() @IsNumber() weightGrams?: number;
  @IsOptional() @IsNumber() lengthCm?: number;
  @IsOptional() @IsNumber() widthCm?: number;
  @IsOptional() @IsNumber() heightCm?: number;

  // Inventory / stock (Phase 8a). Only honoured for BUY_NOW non-firearm
  // listings; >1 opts the listing into multi-unit inventory tracking.
  @IsOptional() @IsInt() @Min(1) quantityAvailable?: number;

  // Number of photos the frontend is about to upload AFTER the create
  // call returns. We use this to fail-fast at create-time when the
  // seller has zero staged images — before this gate, photos uploaded
  // separately could silently fail and leave a published listing with
  // no photos at all. The frontend uploads each file one-by-one
  // POST'ing to /listings/:id/images and is responsible for surfacing
  // any per-file failures.
  @IsInt()
  @Min(1, { message: 'Add at least one photo before publishing.' })
  imageCount: number;
}
