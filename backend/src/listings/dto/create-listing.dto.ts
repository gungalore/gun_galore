import {
  IsString,
  IsInt,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsIn,
  IsArray,
  IsNumber,
  IsObject,
  IsDateString,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ListingType,
  Condition,
  Province,
  ShippingMethod,
  ExperienceType,
} from '@prisma/client';

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

  // UX-7 — optional compare-at / "was" price (ZAR cents). Display-only: shown
  // as a strikethrough + "% off" chip. NEVER enters fee/checkout math. The
  // service validates compareAt > price and caps it at 4× price (CPA s41
  // anti-anchoring), and only allows it on BUY_NOW listings.
  @IsOptional()
  @IsInt()
  @Min(100)
  compareAtPriceZarCents?: number; // ZAR cents

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

  // ZAR cents; TAKE_A_SHOT only — offers at or below this are instantly
  // declined without notifying the seller (the lowball filter). Must sit
  // below autoAcceptThreshold when both are set (service-validated).
  @IsOptional()
  @IsInt()
  @Min(100)
  autoDeclineThreshold?: number;

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

  // Where the seller plans to dealer-stock a firearm/barrel. MANDATORY
  // for firearm listings (2026-07-13) — the service requires all three
  // parts for firearms and composes them into the display string
  // `plannedDealerLocation`. Optional at the DTO layer (non-firearm
  // listings send none); ListingsService enforces presence for firearms.
  @IsOptional() @IsString() @MaxLength(120) plannedDealerName?: string;
  @IsOptional() @IsString() @MaxLength(60) plannedDealerProvince?: string;
  @IsOptional() @IsString() @MaxLength(120) plannedDealerArea?: string;
  // Legacy/derived display string. Server-composed from the three parts
  // above; accepted but ignored on input (kept for backward compat).
  @IsOptional() @IsString() @MaxLength(200) plannedDealerLocation?: string;

  // P3 — papers attestation for NaTIS-registered goods (trailers / off-road
  // caravans). Must be explicitly true when the category has requiresPapers;
  // ListingsService.create re-checks the category flag server-side and
  // refuses without it. Boolean only — we never collect or store the actual
  // registration documents (POPIA). NOT a Listing column — update() strips it.
  @IsOptional()
  @IsBoolean()
  collectionPapersAttested?: boolean;

  // P5.4 — seller's OPTIONAL "tested & working" claim for electronics/appliance
  // categories (Category.showTestedWorkingAttestation). The seller's own
  // statement, never a GG certification (CPA s41). ListingsService.create
  // re-checks the category flag + stamps testedWorkingAttestedAt. Boolean only.
  // NOT a Listing column — update() strips it.
  @IsOptional()
  @IsBoolean()
  testedWorkingAttested?: boolean;

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

  // P4.2 — per-listing attribute VALUES: a free-form { attributeKey: value }
  // object validated in ListingsService against the category's effective
  // CategoryAttribute definitions (class-validator can't know the category's
  // schema, so per-key type/required/option checks live in the service).
  // Only the CLEANED result is ever persisted to Listing.attributes.
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  // ---- Hunting Packages / Experiences (Category.isExperience) ----------
  // Required only when the category is an experience (enforced server-side in
  // ListingsService.create). An experience is a future-dated on-site SERVICE
  // (hunting package / range day): no courier or parcel, Buy Now or Auction
  // only. All fields optional at the DTO layer; the service enforces them
  // only for experience categories and strips them for everything else.
  @IsOptional() @IsEnum(ExperienceType) experienceType?: ExperienceType;
  @IsOptional() @IsDateString() eventStartDate?: string;
  @IsOptional() @IsDateString() eventEndDate?: string;
  @IsOptional() @IsEnum(Province) eventProvince?: Province;
  @IsOptional() @IsString() @MaxLength(200) locationText?: string;
  @IsOptional() @IsInt() @Min(1) capacitySlots?: number;
  @IsOptional() @IsString() @MaxLength(200) durationText?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  speciesList?: string[];
  @IsOptional() @IsString() @MaxLength(5000) whatsIncluded?: string;
  @IsOptional() @IsBoolean() rifleProvided?: boolean;
  // Supplier (outfitter) registration + insurance. Docs uploaded to Cloudinary
  // BEFORE create; URLs passed here for admin / Claude-vision review.
  @IsOptional() @IsString() @MaxLength(120) supplierRegistrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) supplierRegistrationDocUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) supplierInsuranceUrl?: string;
  // Supplier declarations — must all be true when the category is an
  // experience. Boolean only; the service re-checks + stamps supplierAttestedAt.
  @IsOptional() @IsBoolean() supplierPublicLiabilityAttested?: boolean;
  @IsOptional() @IsBoolean() supplierAuthorityAttested?: boolean;
  @IsOptional() @IsBoolean() supplierRiskDisclosureAttested?: boolean;

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
