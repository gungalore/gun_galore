import {
  IsString,
  IsInt,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsIn,
  Min,
  Length,
  MaxLength,
  ValidateIf,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ListingType, Condition, Province, ShippingMethod } from '@prisma/client';

// Dry-run version of CreateListingDto. Used by POST /listings/preview
// to moderate a draft WITHOUT persisting it. Mirrors CreateListingDto
// field-for-field with two additions:
//   - previousAttemptHashes: client-tracked list of hashes from prior
//     REJECT attempts in this session. Lets the server detect "tried
//     to publish the same sin twice" → hard-block.
//   - imageUrls: optional Cloudinary URLs of already-uploaded photos
//     so Claude can see them. For a brand-new listing we usually don't
//     have these yet, so the field is optional.
export class PreviewListingDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  description: string;

  // Price is always optional on PREVIEW (unlike CreateListingDto which
  // requires it for non-TAKE_A_SHOT). The Sell form fires audits after
  // Step 1 — before Step 2 (pricing) is filled — so requiring price
  // here would block early-warning moderation feedback.
  @IsOptional()
  @IsInt()
  @Min(100)
  price?: number;

  // UX-7 — optional compare-at / "was" price (ZAR cents). Display-only; passed
  // through so the moderation preview matches the real create pass.
  @IsOptional()
  @IsInt()
  @Min(100)
  compareAtPriceZarCents?: number;

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

  @IsOptional()
  @IsInt()
  @Min(100)
  autoAcceptThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  autoDeclineThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  reservePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  buyNowPrice?: number;

  @ValidateIf((o) => o.listingType === 'AUCTION')
  @IsInt()
  @IsIn([3, 5, 7, 14])
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  // Soft-block: hashes returned from previous preview calls that REJECTED.
  // If the current attempt would also REJECT and shares the same "sin
  // categories" as any prior one, the response includes hardBlocked=true
  // and the seller can no longer self-publish.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previousAttemptHashes?: string[];

  // Number of photos the seller has staged client-side. We don't have URLs
  // for these yet (upload happens after the listing row exists), but knowing
  // the count lets the moderator flag "no photos" if the seller has none.
  @IsOptional()
  @IsInt()
  @Min(0)
  imageCount?: number;

  // Staged photos as base64-encoded data, attached to the preview call
  // so the moderator can vision-scan them for phone numbers, URLs, QR
  // codes, dealer signage, watermarks etc. BEFORE the seller publishes.
  // Capped to 5 here (Sell form max) — frontend should send the full
  // staged set. Each entry has a media type + the base64 payload
  // WITHOUT the `data:image/...;base64,` prefix.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  images?: Array<{
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    data: string;
  }>;

  // ---- Delivery + pickup address (mirror CreateListingDto) -------------
  // Optional on preview — moderation doesn't need them — but accepted so
  // the same payload shape works for both endpoints.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsEnum(ShippingMethod, { each: true })
  shippingMethods?: ShippingMethod[];

  @IsOptional() @IsString() @MaxLength(120) pickupBuilding?: string;
  @IsOptional() @IsString() @MaxLength(200) pickupStreet?: string;
  @IsOptional() @IsString() @MaxLength(200) pickupAddress2?: string;
  @IsOptional() @IsString() @MaxLength(120) pickupSuburb?: string;
  @IsOptional() @IsString() @MaxLength(120) pickupCity?: string;
  @IsOptional() @IsString() @MaxLength(10) pickupPostalCode?: string;
  @IsOptional() @IsNumber() pickupLat?: number;
  @IsOptional() @IsNumber() pickupLng?: number;
  @IsOptional() @IsString() @MaxLength(60) pickupPudoLockerId?: string;

  // Parcel weight + dimensions (preview shape mirrors create — see
  // create-listing.dto.ts for the lifecycle notes).
  @IsOptional() @IsNumber() weightGrams?: number;
  @IsOptional() @IsNumber() lengthCm?: number;
  @IsOptional() @IsNumber() widthCm?: number;
  @IsOptional() @IsNumber() heightCm?: number;
}
